"""File parser — extracts text from PDF, DOCX, TXT, and image files."""

import os


SUPPORTED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp"}


def parse_file(content: bytes, filename: str) -> str:
    """Extract text from a file based on its extension."""
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".txt":
        return content.decode("utf-8", errors="replace")

    if ext == ".pdf":
        return _parse_pdf(content)

    if ext == ".docx":
        return _parse_docx(content)

    if ext in SUPPORTED_IMAGE_EXTS:
        return _parse_image(content, filename)

    raise ValueError(f"Unsupported file type: {ext}")


def _parse_pdf(content: bytes) -> str:
    """Extract text from PDF using PyMuPDF."""
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()
    return "\n".join(pages)


def _parse_docx(content: bytes) -> str:
    """Extract text from DOCX using python-docx."""
    import docx
    import io
    doc = docx.Document(io.BytesIO(content))
    paragraphs = []
    for para in doc.paragraphs:
        if para.text.strip():
            paragraphs.append(para.text)
    return "\n".join(paragraphs)


def _parse_image(content: bytes, filename: str) -> str:
    """Extract text from images using OCR, with fallback to image metadata."""
    from PIL import Image
    import io

    try:
        text = _ocr_image(content)
        if text and text.strip():
            return text.strip()
    except Exception:
        pass

    # Fallback: return basic image info
    img = Image.open(io.BytesIO(content))
    return f"[Image: {filename}, {img.width}x{img.height}, {img.mode}]"


def _ocr_image(content: bytes) -> str | None:
    """Attempt OCR on image content using pytesseract."""
    try:
        import pytesseract
        from PIL import Image
        import io

        # Try to locate tesseract binary if not on PATH
        if not _tesseract_on_path():
            _configure_tesseract_path(pytesseract)

        img = Image.open(io.BytesIO(content))
        # Try Chinese + English for broad coverage
        text = pytesseract.image_to_string(img, lang="chi_sim+eng")
        if text and text.strip():
            return text.strip()
    except Exception:
        pass
    return None


def _tesseract_on_path() -> bool:
    """Check if tesseract is accessible on PATH."""
    import shutil
    return shutil.which("tesseract") is not None


def _configure_tesseract_path(pytesseract_module) -> None:
    """Search common install paths for tesseract binary."""
    import os.path
    common_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for path in common_paths:
        if os.path.exists(path):
            pytesseract_module.pytesseract.tesseract_cmd = path
            break

    # Set tessdata directory to user-writable location
    user_tessdata = os.path.expanduser(r"~\tessdata")
    if os.path.exists(user_tessdata):
        os.environ["TESSDATA_PREFIX"] = user_tessdata
