import numpy as np
import pytest

from agmeo_geo.colormaps import SCALES
from agmeo_geo.sources import BANDS, INDICES, index_layers


def test_index_formulas():
    reflectance = {"blue": 0.04, "red": 0.05, "nir": 0.40, "nir08": 0.38, "rededge1": 0.10, "swir16": 0.20}
    r = {key: np.array([value]) for key, value in {**reflectance, "swir22": 0.12}.items()}
    assert set(r) == set(BANDS)
    layers = index_layers(r)
    assert tuple(layers) == INDICES
    assert layers["ndvi"][0] == pytest.approx(0.35 / 0.45)
    assert layers["ndre"][0] == pytest.approx(0.28 / 0.48)
    assert layers["ndmi"][0] == pytest.approx(0.20 / 0.60)
    assert layers["evi"][0] == pytest.approx(2.5 * 0.35 / (0.40 + 0.30 - 0.30 + 1))
    assert layers["bsi"][0] == pytest.approx((0.25 - 0.44) / (0.25 + 0.44))
    assert layers["ndti"][0] == pytest.approx(0.08 / 0.32)


def test_missing_reflectance_gives_no_value():
    r = {key: np.array([np.nan, 0.1]) for key in BANDS}
    layers = index_layers(r)
    assert all(np.isnan(layer[0]) for layer in layers.values())


def test_every_index_has_a_display_scale():
    assert set(SCALES) == set(INDICES)
