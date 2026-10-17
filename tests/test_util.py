import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.util import double, subtract
def test_double():
    assert double(2) == 4
    assert double(0) == 0
    assert double(-3) == -6
    assert double(2.5) == 5.0
def test_subtract():
    assert subtract(5, 3) == 2
    assert subtract(3, 5) == -2
    assert subtract(0, 0) == 0
    assert subtract(2.5, 1.5) == 1.0
