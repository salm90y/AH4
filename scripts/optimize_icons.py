from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "images" / "icon.png"
OUTPUTS = {
    "icon.png": 512,
    "splash-icon.png": 512,
    "favicon.png": 128,
    "android-icon-foreground.png": 512,
}


def optimize() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    for filename, side in OUTPUTS.items():
        rendered = source.copy()
        rendered.thumbnail((side, side), Image.Resampling.LANCZOS)
        destination = ROOT / "assets" / "images" / filename
        rendered.save(destination, format="PNG", optimize=True, compress_level=9)
        print(f"{filename}: {destination.stat().st_size} bytes")


if __name__ == "__main__":
    optimize()
