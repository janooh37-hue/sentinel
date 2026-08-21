"""Deterministic in-repository test doubles.

Nothing here may ever be selected as a production fallback: the production
provider resolver stays explicitly ``not_configured`` until a real installed
BioTime adapter exists.
"""
