"""Indices on dimensionless BOA reflectance, on one aligned raster grid."""

import re

import numpy as np

FORMULAS = {
    "NDVI": "(B08-B04)/(B08+B04)",
    "NDRE": "(B8A-B05)/(B8A+B05)",
    "GNDVI": "(B08-B03)/(B08+B03)",
    "EVI": "2.5*(B08-B04)/(B08+6*B04-7.5*B02+1)",
    "EVI2": "2.5*(B08-B04)/(B08+2.4*B04+1)",
    "SAVI": "1.5*(B08-B04)/(B08+B04+0.5)",
    "MSAVI2": "(2*B08+1-sqrt((2*B08+1)^2-8*(B08-B04)))/2",
    "NDMI": "(B08-B11)/(B08+B11)",
    "MSI": "B11/B08",
    "CIgreen": "B08/B03-1",
    "CIred-edge": "B8A/B05-1",
    "IRECI": "(B07-B04)/(B05/B06)",
    "MCARI": "((B05-B04)-0.2*(B05-B03))*(B05/B04)",
    "OSAVI": "1.16*(B08-B04)/(B08+B04+0.16)",
    "NBR2": "(B11-B12)/(B11+B12)",
    "BSI": "((B11+B04)-(B08+B02))/((B11+B04)+(B08+B02))",
    "NDTI": "(B11-B12)/(B11+B12)",
}
INPUTS = {name: sorted(set(re.findall(r"B\d[\dA]", formula))) for name, formula in FORMULAS.items()}
# Indices whose inputs are all native 10 m bands; only these can be computed on the 10 m grid.
NATIVE_10M = [name for name, bands in INPUTS.items() if set(bands) <= {"B02", "B03", "B04", "B08"}]


def ratio(a, b):
    a, b = np.broadcast_arrays(a, b)
    return np.divide(a, b, out=np.full(a.shape, np.nan, dtype=np.float32), where=np.abs(b) > 1e-8)


def calculate(bands, selected=None):
    """Compute the selected indices (default all); bands only needs their INPUTS."""
    blue, green, red = (bands.get(b) for b in ("B02", "B03", "B04"))
    re1, re2, re3 = (bands.get(b) for b in ("B05", "B06", "B07"))
    nir, narrow, swir1, swir2 = (bands.get(b) for b in ("B08", "B8A", "B11", "B12"))
    nd = lambda a, b: ratio(a - b, a + b)
    formulas = {
        "NDVI": lambda: nd(nir, red),
        "NDRE": lambda: nd(narrow, re1),
        "GNDVI": lambda: nd(nir, green),
        "EVI": lambda: 2.5 * ratio(nir - red, nir + 6 * red - 7.5 * blue + 1),
        "EVI2": lambda: 2.5 * ratio(nir - red, nir + 2.4 * red + 1),
        "SAVI": lambda: 1.5 * ratio(nir - red, nir + red + 0.5),
        "MSAVI2": lambda: (2 * nir + 1 - np.sqrt((2 * nir + 1) ** 2 - 8 * (nir - red))) / 2,
        "NDMI": lambda: nd(nir, swir1),
        "MSI": lambda: ratio(swir1, nir),
        "CIgreen": lambda: ratio(nir, green) - 1,
        "CIred-edge": lambda: ratio(narrow, re1) - 1,
        "IRECI": lambda: ratio(re3 - red, ratio(re1, re2)),
        "MCARI": lambda: ((re1 - red) - 0.2 * (re1 - green)) * ratio(re1, red),
        "OSAVI": lambda: 1.16 * ratio(nir - red, nir + red + 0.16),
        "NBR2": lambda: nd(swir1, swir2),
        "BSI": lambda: nd(swir1 + red, nir + blue),
        "NDTI": lambda: nd(swir1, swir2),
    }
    result = {}
    with np.errstate(invalid="ignore", divide="ignore", over="ignore"):
        for name in selected or formulas:
            value = formulas[name]()
            result[name] = np.where(np.isfinite(value), value, np.nan).astype("float32")
    return result
