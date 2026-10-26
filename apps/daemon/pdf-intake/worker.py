"""Read-only PDF inputs; render pages and make traceable crops for the Node host."""
import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image
import pdfplumber
import pypdfium2 as pdfium


def render(args):
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(args.input)
    selected = json.loads(args.pages) if args.pages else list(range(1, len(document) + 1))
    if any(type(p) is not int or p < 1 or p > len(document) for p in selected):
        raise ValueError("Page selection is outside the document")
    pages = []
    with pdfplumber.open(args.input) as source:
        for number in selected:
            page = document[number - 1]
            # Bound the longest edge, including large A0/A1 drawings.
            scale = min(2.2, 2400 / max(page.get_size()))
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil().convert("RGB")
            filename = f"page-{number:04}.png"
            image.save(output / filename)
            text = source.pages[number - 1].extract_text() or ""
            pages.append({"page": number, "file": filename, "width": image.width,
                          "height": image.height, "text": text[:6000]})
            image.close()
            bitmap.close()
            page.close()
    result = {"pageCount": len(document), "pages": pages}
    document.close()
    return result


def crop(args):
    box = json.loads(args.box)
    if len(box) != 4 or not all(isinstance(n, (int, float)) for n in box):
        raise ValueError("Expected four normalized crop coordinates")
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= 1000 and 0 <= y0 < y1 <= 1000):
        raise ValueError("Invalid crop coordinates")
    if args.page:
        # Re-render from the PDF, rather than enlarging the analysis thumbnail.
        # A small detail on an A0 board must retain usable source resolution.
        document = pdfium.PdfDocument(args.input)
        page = document[args.page - 1]
        width, height = page.get_size()
        region_width = (x1 - x0) * width / 1000
        region_height = (y1 - y0) * height / 1000
        margins = (x0 * width / 1000, (1000 - y1) * height / 1000,
                   (1000 - x1) * width / 1000, y0 * height / 1000)
        bitmap = page.render(scale=min(3, 3000 / max(region_width, region_height)), crop=margins)
        cropped = bitmap.to_pil().convert("RGB")
        cropped.save(args.output)
        result = {"width": cropped.width, "height": cropped.height}
        cropped.close()
        bitmap.close()
        page.close()
        document.close()
        return result
    with Image.open(args.input) as image:
        bounds = (int(x0 * image.width / 1000), int(y0 * image.height / 1000),
                  round(x1 * image.width / 1000), round(y1 * image.height / 1000))
        cropped = image.crop(bounds)
        if cropped.width < 16 or cropped.height < 16:
            raise ValueError("Crop is too small")
        cropped.save(args.output)
        return {"width": cropped.width, "height": cropped.height}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["render", "crop"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pages")
    parser.add_argument("--box")
    parser.add_argument("--page", type=int)
    arguments = parser.parse_args()
    print(json.dumps(render(arguments) if arguments.action == "render" else crop(arguments), ensure_ascii=False))
