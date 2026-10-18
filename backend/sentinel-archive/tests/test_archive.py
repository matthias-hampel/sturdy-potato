import io
import json
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
import rasterio
import requests
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.windows import Window
from shapely.geometry import box, mapping

from sentinel_archive import catalogue, download, processing
from sentinel_archive.indices import NATIVE_10M, calculate


def product(identifier="11111111-1111-1111-1111-111111111111", footprint=None):
    return {
        "Id": identifier,
        "Name": "S2A_TEST.SAFE",
        "ContentDate": {"Start": "2020-01-01T10:00:00Z"},
        "PublicationDate": "2024-01-01T00:00:00Z",
        "ContentLength": 100,
        "Online": True,
        "GeoFootprint": mapping(footprint if footprint is not None else box(8, 52, 9, 53)),
    }


def response(data):
    return SimpleNamespace(raise_for_status=lambda: None, json=lambda: data)


def test_pagination_restart_and_spatial_filter(tmp_path):
    db = catalogue.connect(tmp_path / "db")
    client = Mock()
    first = {"value": [product()], "@odata.nextLink": catalogue.CATALOGUE + "?$skip=1"}
    client.get.side_effect = [response(first), requests.ConnectionError("interrupted")]
    arguments = (
        client,
        db,
        box(7, 51, 10, 54),
        catalogue.timestamp("2020-01-01"),
        catalogue.timestamp("2020-02-01"),
    )
    with pytest.raises(requests.ConnectionError):
        catalogue.scan(*arguments)
    assert db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM scans").fetchone()[0] == 0
    client.get.side_effect = [response(first), response({"value": [product("outside", box(0, 0, 1, 1))]})]
    catalogue.scan(*arguments)
    assert db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 1
    client.get.reset_mock()
    catalogue.scan(*arguments)
    client.get.assert_not_called()


def test_publication_cursor_does_not_advance_after_failure(tmp_path, monkeypatch):
    db = catalogue.connect(tmp_path / "db")
    monkeypatch.setattr(catalogue, "discover", lambda *args: None)
    monkeypatch.setattr(catalogue, "scan", Mock(side_effect=requests.ConnectionError()))
    now = datetime(2026, 10, 18, tzinfo=UTC)
    with pytest.raises(requests.ConnectionError):
        catalogue.sync_catalogue(Mock(), db, box(8, 52, 9, 53), catalogue.timestamp("2020-01-01"), now)
    assert db.execute("SELECT value FROM state").fetchone()[0] == "2026-10-04T00:00:00Z"


def test_month_boundaries_leap_year_and_timezone():
    windows = list(
        catalogue.monthly_windows(catalogue.timestamp("2020-01-15"), catalogue.timestamp("2020-03-02"))
    )
    assert [b.date().isoformat() for _, b in windows] == ["2020-02-01", "2020-03-01", "2020-03-02"]
    assert catalogue.iso(catalogue.timestamp("2020-01-01T02:00:00+02:00")) == "2020-01-01T00:00:00Z"


def xml_metadata(baseline="05.00", with_offsets=True):
    offsets = "".join(f'<BOA_ADD_OFFSET band_id="{i}">-1000</BOA_ADD_OFFSET>' for i in range(13))
    return (
        f"<root><PROCESSING_BASELINE>{baseline}</PROCESSING_BASELINE>"
        "<BOA_QUANTIFICATION_VALUE>10000</BOA_QUANTIFICATION_VALUE>"
        f"{offsets if with_offsets else ''}</root>"
    ).encode()


def test_offsets_required_for_new_baselines():
    scale, offsets, _ = processing.reflectance_metadata(xml_metadata())
    assert (3000 + offsets["B04"]) / scale == 0.2
    assert processing.reflectance_metadata(xml_metadata("03.00", False))[1]["B04"] == 0
    with pytest.raises(ValueError, match="explicit BOA offsets"):
        processing.reflectance_metadata(xml_metadata("04.00", False))


def test_indices_reference_values_and_invalid_pixels():
    bands = {
        b: np.array([value, np.nan], dtype="float32")
        for b, value in {
            "B02": 0.1,
            "B03": 0.15,
            "B04": 0.2,
            "B05": 0.25,
            "B06": 0.3,
            "B07": 0.4,
            "B08": 0.6,
            "B8A": 0.5,
            "B11": 0.3,
            "B12": 0.2,
        }.items()
    }
    values = calculate(bands)
    expected = {
        "NDVI": 0.5,
        "NDRE": 1 / 3,
        "GNDVI": 0.6,
        "EVI": 2 / 4.1,
        "EVI2": 1 / 2.08,
        "SAVI": 0.6 / 1.3,
        "MSAVI2": (2.2 - np.sqrt(1.64)) / 2,
        "NDMI": 1 / 3,
        "MSI": 0.5,
        "CIgreen": 3,
        "CIred-edge": 1,
        "IRECI": 0.24,
        "MCARI": 0.0375,
        "OSAVI": 0.464 / 0.96,
        "NBR2": 0.2,
        "BSI": -1 / 6,
        "NDTI": 0.2,
    }
    for name, expected_value in expected.items():
        assert values[name][0] == pytest.approx(expected_value, abs=1e-6)
        assert np.isnan(values[name][1])
    zeros = calculate({b: np.zeros(1) for b in bands})
    assert np.isnan(zeros["NDVI"][0])
    assert np.isnan(zeros["IRECI"][0])
    fine = calculate({b: bands[b] for b in ("B02", "B03", "B04", "B08")}, NATIVE_10M)
    assert list(fine) == NATIVE_10M
    assert fine["EVI"][0] == pytest.approx(expected["EVI"], abs=1e-6)


def zip_bytes():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("S2A_TEST.SAFE/MTD_MSIL2A.xml", "<test/>")
    return data.getvalue()


def fake_download(payload, length=None):
    result = Mock()
    result.headers = {"Content-Length": str(len(payload) if length is None else length)}
    result.iter_content.return_value = [payload]
    result.__enter__ = Mock(return_value=result)
    result.__exit__ = Mock(return_value=False)
    return result


def row():
    p = product()
    return {
        "id": p["Id"],
        "name": p["Name"],
        "acquired": p["ContentDate"]["Start"],
        "bytes": p["ContentLength"],
        "metadata": json.dumps(p),
    }


def test_download_atomic_completion_and_crash_recovery(tmp_path, monkeypatch):
    opener = Mock(return_value=fake_download(zip_bytes()))
    monkeypatch.setattr(download, "open_download", opener)
    path, digest = download.download_one(Mock(), Mock(), row(), tmp_path, 0)
    assert path.exists() and download.sha256(path) == digest
    assert not list(tmp_path.rglob("*.part"))
    assert download.download_one(Mock(), Mock(), row(), tmp_path, 0) == (path, digest)
    assert opener.call_count == 1


def test_incomplete_download_never_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(download, "open_download", Mock(return_value=fake_download(zip_bytes(), 99999)))
    with pytest.raises(ValueError, match="Incomplete"):
        download.download_one(Mock(), Mock(), row(), tmp_path, 0)
    assert not list(tmp_path.rglob("*.zip"))
    assert not list(tmp_path.rglob("*.part"))


def test_failed_download_does_not_starve_other_products(tmp_path, monkeypatch):
    db = catalogue.connect(tmp_path / "db")
    for identifier in ("a", "b"):
        db.execute(
            "INSERT INTO products(id,name,acquired,published,bytes,online,metadata) VALUES(?,?,?,?,?,?,?)",
            (identifier, "S2A_TEST.SAFE", "2020-01-01", "2024-01-01", 100, 1, "{}"),
        )
    db.commit()
    downloaded = []

    def fail(client, auth, product, *args):
        downloaded.append(product["id"])
        raise ValueError("failure")

    monkeypatch.setattr(download, "download_one", fail)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="downloads failed"):
            download.download_pending(Mock(), db, Mock(), tmp_path, limit=1, reserve_gb=0)
    assert downloaded == ["a", "b"]


def test_redirect_token_not_sent_to_other_hosts():
    client = Mock()
    client.get.return_value.status_code = 302
    client.get.return_value.headers = {"Location": "https://untrusted.example/download"}
    with pytest.raises(ValueError, match="redirect host"):
        download.open_download(client, download.DOWNLOAD, Mock())
    assert client.get.call_count == 1


def sample_product(tmp_path):
    source = tmp_path / "sample.zip"
    dns = {
        "B02": 2000,
        "B03": 2500,
        "B04": 3000,
        "B05": 3500,
        "B06": 4000,
        "B07": 5000,
        "B08": 7000,
        "B8A": 6000,
        "B11": 4000,
        "B12": 3000,
        "SCL": 4,
    }
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("S2A_TEST.SAFE/MTD_MSIL2A.xml", xml_metadata())
        for band, value in dns.items():
            resolution = 10 if band in ("B02", "B03", "B04", "B08") else 20
            size = 32 if resolution == 10 else 16
            data = np.full((size, size), value, dtype="uint16")
            if band == "SCL":
                data[0, 0] = 9
            if band == "B04":
                data[2:4, 2:4] = 0
            if band == "B08":
                # Mean DN=7000; a nearest-neighbour implementation would differ.
                data[10:12, 10:12] = [[4000, 6000], [8000, 10000]]
            path = tmp_path / f"T32U_TEST_{band}_{resolution}m.jp2"
            with rasterio.open(
                path,
                "w",
                driver="JP2OpenJPEG",
                width=size,
                height=size,
                count=1,
                dtype="uint16",
                crs="EPSG:32632",
                transform=from_origin(500000, 5800000, resolution, resolution),
                REVERSIBLE="YES",
                QUALITY=100,
            ) as dst:
                dst.write(data, 1)
            archive.write(path, f"S2A_TEST.SAFE/GRANULE/TEST/IMG_DATA/R{resolution}m/{path.name}")
    return source


def test_safe_to_cog_with_actual_jpeg2000_resampling_and_cloud_mask(tmp_path):
    output = tmp_path / "indices.tif"
    processing.process(sample_product(tmp_path), output, ["NDVI", "EVI2"], cloud_buffer=40)
    with rasterio.open(output) as result:
        assert result.res == (20, 20)
        assert np.isnan(result.read(1)[0, 2])  # 40 m from the cloud: inside the buffer
        assert not np.isnan(result.read(1)[0, 3])  # 60 m
        assert result.descriptions == ("NDVI", "EVI2")
        assert result.tags(ns="IMAGE_STRUCTURE")["LAYOUT"] == "COG"
        assert np.isnan(result.read(1)[0, 0])  # cloud
        assert np.isnan(result.read(1)[1, 1])  # original DN=0 remains nodata after offset
        assert result.read(1)[5, 5] == pytest.approx(0.5, abs=1e-5)
        assert result.read(2)[5, 5] == pytest.approx(1 / 2.08, abs=1e-5)
    metadata = json.loads(output.with_suffix(".json").read_text())
    assert metadata["cloud_buffer_m"] == 40


def test_cloud_buffer_does_not_depend_on_window_edges():
    scl = np.full((40, 40), 4, dtype="uint8")
    scl[19, 19] = 9  # next to the quarter-window corner
    scl[0, 39] = 3
    scl[30, 5] = 8
    scl[35, 30] = 7  # unclassified: masked itself, but not buffered
    profile = {
        "driver": "GTiff",
        "width": 40,
        "height": 40,
        "count": 1,
        "dtype": "uint8",
        "crs": "EPSG:32632",
    }
    profile["transform"] = from_origin(500000, 5800000, 10, 10)
    with MemoryFile() as memory, memory.open(**profile) as dataset:
        dataset.write(scl, 1)
        whole = processing.clear_pixels(dataset, Window(0, 0, 40, 40), 50, 10)
        quarters = np.block(
            [
                [processing.clear_pixels(dataset, Window(c, r, 20, 20), 50, 10) for c in (0, 20)]
                for r in (0, 20)
            ]
        )
        unbuffered = processing.clear_pixels(dataset, Window(0, 0, 40, 40), 0, 10)
    np.testing.assert_array_equal(quarters, whole)
    assert not whole[19, 24] and whole[19, 25]  # 50 m vs 60 m
    assert not whole[35, 30] and whole[35, 28]
    assert unbuffered.sum() == 40 * 40 - 4


def test_native_10m_grid_keeps_10m_detail(tmp_path):
    source = sample_product(tmp_path)
    with pytest.raises(ValueError, match="NDRE use 20 m bands"):
        processing.process(source, tmp_path / "mixed.tif", ["NDVI", "NDRE"], resolution=10)
    output = tmp_path / "indices-10m.tif"
    processing.process(source, output, ["NDVI", "EVI2"], resolution=10, cloud_buffer=0)
    with rasterio.open(output) as result:
        ndvi = result.read(1)
        assert result.res == (10, 10)
        assert result.shape == (32, 32)
        assert np.isnan(ndvi[:2, :2]).all()  # 20 m cloud pixel covers four 10 m pixels
        assert not np.isnan(ndvi[2, 0])
        assert np.isnan(ndvi[2:4, 2:4]).all()  # B04 DN=0 stays at 10 m size
        # B08 DNs 4000/6000/8000/10000 with B04 3000 (offset -1000): per-pixel, not averaged.
        assert ndvi[10:12, 10:12] == pytest.approx(np.array([[0.1 / 0.5, 0.3 / 0.7], [0.5 / 0.9, 0.7 / 1.1]]))
        assert ndvi[5, 5] == pytest.approx(0.5, abs=1e-5)
    assert json.loads(output.with_suffix(".json").read_text())["resolution_m"] == 10


def test_derive_writes_assets_and_manifest(tmp_path):
    from rasterio.warp import transform_geom

    from sentinel_archive import derive

    source = sample_product(tmp_path)
    utm = mapping(box(500000, 5800000 - 320, 500000 + 320, 5800000))
    db = catalogue.connect(tmp_path / "catalogue.sqlite")
    metadata = {"GeoFootprint": transform_geom("EPSG:32632", "EPSG:4326", utm)}
    db.execute(
        "INSERT INTO products (id, name, acquired, published, bytes, online, metadata, status, path)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?)",
        (
            "22222222-2222-2222-2222-222222222222",
            "S2A_MSIL2A_20240601T103021_N0510_R108_T32UNC_20240601T150000.SAFE",
            "2024-06-01T10:30:21Z",
            "2024-06-01T15:00:00Z",
            100,
            1,
            json.dumps(metadata),
            str(source),
        ),
    )
    db.commit()
    archive = tmp_path / "archive"
    rows = derive.pending(db, archive, 10)
    assert len(rows) == 1
    manifest = derive.derive_product(rows[0], archive, cloud_buffer=0)
    directory = derive.product_dir(archive, rows[0]["id"])
    assert set(manifest["assets"]) == {"ndvi", "evi", "ndre", "ndmi", "bsi", "ndti"}
    assert manifest["assets"]["ndti"] == {"path": "soil-20m.tif", "band": 2, "resolution_m": 20}
    assert manifest["assets"]["ndvi"] == {"path": "ndvi-10m.tif", "band": 1, "resolution_m": 10}
    assert manifest["tile"] == "32UNC" and manifest["platform"] == "S2A"
    # One cloud pixel and one nodata block out of a fully covered footprint.
    assert 0.8 < manifest["clear_fraction"] < 1
    with rasterio.open(directory / "indices-20m.tif") as result:
        assert result.descriptions == ("NDRE", "NDMI")
    with rasterio.open(directory / "soil-20m.tif") as result:
        assert result.descriptions == ("BSI", "NDTI")
    assert json.loads((directory / "manifest.json").read_text())["product_id"] == rows[0]["id"]
    assert derive.pending(db, archive, 10) == []

    # A manifest of an earlier processing version is re-derived; existing asset files are kept.
    stale = json.loads((directory / "manifest.json").read_text())
    stale["processing_version"] = "s2-indices-2"
    (directory / "manifest.json").write_text(json.dumps(stale))
    (directory / "soil-20m.tif").unlink()
    ndvi_mtime = (directory / "ndvi-10m.tif").stat().st_mtime_ns
    assert len(derive.pending(db, archive, 10)) == 1
    derive.derive_product(rows[0], archive, cloud_buffer=0)
    assert (directory / "soil-20m.tif").exists()
    assert (directory / "ndvi-10m.tif").stat().st_mtime_ns == ndvi_mtime
    assert derive.pending(db, archive, 10) == []
