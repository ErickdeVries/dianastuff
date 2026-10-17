import os
from types import SimpleNamespace

# Keep module import isolated from the production Atlas URI in backend/.env.
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "dianastuff_ai_unit_test"

from backend import server


def _response_with(*, content=None, images=None):
    message = SimpleNamespace(content=content, images=images or [])
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def test_compat_response_images_accepts_message_images():
    image = SimpleNamespace(
        image_url=SimpleNamespace(url="data:image/png;base64,aGVsbG8=")
    )
    result = server._compat_response_images(_response_with(images=[image]))
    assert result == [{"data": "aGVsbG8=", "mime_type": "image/png"}]


def test_compat_response_images_accepts_content_data_url():
    result = server._compat_response_images(
        _response_with(content="data:image/jpeg;base64,aGVsbG8=")
    )
    assert result == [{"data": "aGVsbG8=", "mime_type": "image/jpeg"}]


def test_openai_compatible_requires_base_and_key(monkeypatch):
    monkeypatch.setattr(server, "OPENAI_BASE_URL", "https://router.invalid/v1")
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    assert server._use_openai_compat() is True
    monkeypatch.setattr(server, "OPENAI_API_KEY", "")
    assert server._use_openai_compat() is False


def test_product_info_json_extraction():
    data = server._extract_json_obj(
        '```json\n{"nama_produk":"Tas Baru","deskripsi":"Deskripsi AI","kategori":"Tas"}\n```'
    )
    assert data["nama_produk"] == "Tas Baru"
    assert data["deskripsi"] == "Deskripsi AI"


def test_product_info_normalizes_english_aliases():
    data = server._normalize_product_info({
        "product_name": "Tas Baru",
        "description": "Deskripsi AI",
        "category": "Tas",
    })
    assert data == {
        "nama_produk": "Tas Baru",
        "deskripsi": "Deskripsi AI",
        "kategori": "Tas",
    }


def test_product_info_normalization_ignores_non_string_values():
    data = server._normalize_product_info({
        "nama_produk": {"value": "Tas Baru"},
        "deskripsi": None,
        "kategori": " Tas ",
    })
    assert data == {"kategori": "Tas"}


def test_compat_response_text_accepts_plain_string():
    result = server._compat_response_text(
        _response_with(content='{"nama_produk":"Tas Baru"}')
    )
    assert result == '{"nama_produk":"Tas Baru"}'


def test_compat_response_text_accepts_content_parts():
    result = server._compat_response_text(
        _response_with(content=[
            {"type": "text", "text": '{"nama_produk":"Tas Baru",'},
            SimpleNamespace(text='"kategori":"Tas"}'),
        ])
    )
    assert result == '{"nama_produk":"Tas Baru",\n"kategori":"Tas"}'


def test_compat_response_text_handles_empty_choices():
    assert server._compat_response_text(SimpleNamespace(choices=[])) == ""


def test_gemini_response_images_accepts_camel_case_inline_data():
    result = server._gemini_response_images({
        "candidates": [{"content": {"parts": [{
            "inlineData": {"mimeType": "image/png", "data": "aGVsbG8="}
        }]}}]
    })
    assert result == [{"data": "aGVsbG8=", "mime_type": "image/png"}]


def test_gemini_response_images_ignores_text_parts():
    result = server._gemini_response_images({
        "candidates": [{"content": {"parts": [{"text": "done"}]}}]
    })
    assert result == []


def test_gemini_response_text_collects_candidate_parts():
    result = server._gemini_response_text({
        "candidates": [{"content": {"parts": [
            {"text": '{"nama_produk":"Tas Baru",'},
            {"text": '"kategori":"Tas"}'},
            {"inlineData": {"mimeType": "image/png", "data": "ignored"}},
        ]}}]
    })
    assert result == '{"nama_produk":"Tas Baru",\n"kategori":"Tas"}'
