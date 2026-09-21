from app import setup_studio


def test_setup_studio_default_credentials_match_documented_login():
    assert setup_studio.EMAIL == "studio@spatialanthology.in"
    assert setup_studio.PASSWORD == "spatialanthology"
