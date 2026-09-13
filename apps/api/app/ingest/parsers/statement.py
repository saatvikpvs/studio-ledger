"""Reading an Indian bank statement.

There is no common format. Header rows start at row 1 or row 21. Amounts appear
as one signed column, or as ``Withdrawal Amt.`` / ``Deposit Amt.``, or as a value
plus a Cr/Dr flag. Dates arrive as 13/09/26, 13-Sep-2026, or an Excel serial.
Files carry preamble banners and footer disclaimers.

So: a profile system with a mapping fallback, never a hardcoded parser per bank
buried in an if-chain. If nothing matches, the caller opens the mapping wizard
and the user maps the columns once, forever.

Every cell is read as a string. We never let a library infer a date or a number.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime

from ...core.money import MoneyError, to_paise

# --------------------------------------------------------------------------
# header vocabulary
# --------------------------------------------------------------------------

SYNONYMS: dict[str, list[str]] = {
    "date": ["value date", "transaction date", "txn date", "tran date", "date",
             "posting date", "post date"],
    "description": ["narration", "particulars", "transaction remarks", "description",
                    "remarks", "details", "transaction details"],
    "debit": ["withdrawal amt", "withdrawal amount", "withdrawal", "debit amount",
              "debit", "paid out", "dr amount"],
    "credit": ["deposit amt", "deposit amount", "deposit", "credit amount",
               "credit", "paid in", "cr amount"],
    "amount": ["transaction amount", "amount (inr)", "amount"],
    "balance": ["closing balance", "running balance", "balance (inr)", "balance"],
    # Written in the normalised form _key() produces: lower case, and dots,
    # underscores and slashes all collapsed to single spaces.
    "ref": ["utr", "chq ref number", "chq ref no", "ref no cheque no",
            "reference no", "cheque no", "reference", "transaction id",
            "ref no", "ref"],
    "drcr": ["dr cr", "cr dr", "transaction type", "type"],
}

DATE_FORMATS = [
    "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y",
    "%d-%b-%Y", "%d-%b-%y", "%d %b %Y", "%d %b, %Y",
    "%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y", "%d.%m.%y",
]

_WS = re.compile(r"\s+")


def _key(text: str) -> str:
    """Normalise a header cell for matching.

    Dots go entirely, not just trailing ones -- HDFC writes "Chq./Ref.No."
    and ICICI writes "Withdrawal Amt.", and both must match their synonym.
    """
    cleaned = (
        str(text or "").lower().replace(".", " ").replace("_", " ").replace("/", " ")
    )
    return _WS.sub(" ", cleaned).strip().strip(":")


@dataclass(slots=True)
class RawRow:
    row_index: int
    value_date: date
    description: str
    direction: str          # "credit" | "debit"
    amount: int             # positive paise
    balance: int | None = None
    reference: str | None = None
    source_cells: dict = field(default_factory=dict)


@dataclass(slots=True)
class ParseResult:
    rows: list[RawRow]
    errors: list[dict]
    header_row: int
    columns: list[str]
    column_map: dict[str, int]
    preview: list[list[str]]
    warnings: list[str] = field(default_factory=list)
    needs_mapping: bool = False


class StatementError(ValueError):
    pass


# --------------------------------------------------------------------------
# loading -- everything becomes a grid of strings
# --------------------------------------------------------------------------

def load_grid(data: bytes, filename: str) -> list[list[str]]:
    lower = filename.lower()
    if lower.endswith((".csv", ".txt")):
        return _load_csv(data)
    if lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        return _load_xlsx(data)
    if lower.endswith(".xls"):
        raise StatementError(
            "Legacy .xls files are not supported. Open it and re-save as .xlsx or CSV."
        )
    raise StatementError(f"Unsupported file type: {filename}")


def _load_csv(data: bytes) -> list[list[str]]:
    text = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:  # pragma: no cover - latin-1 always succeeds
        raise StatementError("Could not decode this file as text.")

    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return [list(row) for row in csv.reader(io.StringIO(text), dialect)]


def _load_xlsx(data: bytes) -> list[list[str]]:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover
        raise StatementError("openpyxl is required to read Excel statements.") from exc

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheet = workbook.active
    grid: list[list[str]] = []
    for row in sheet.iter_rows(values_only=True):
        cells = []
        for value in row:
            if value is None:
                cells.append("")
            elif isinstance(value, datetime):
                cells.append(value.date().isoformat())
            elif isinstance(value, date):
                cells.append(value.isoformat())
            elif isinstance(value, float) and value.is_integer():
                cells.append(str(int(value)))
            else:
                cells.append(str(value))
        grid.append(cells)
    workbook.close()
    return grid


# --------------------------------------------------------------------------
# header location and mapping
# --------------------------------------------------------------------------

def find_header(grid: list[list[str]], scan: int = 40) -> tuple[int, dict[str, int]]:
    """Find the real header row, discarding the bank's preamble banner."""
    best_row, best_map, best_score = -1, {}, 0

    for index, row in enumerate(grid[:scan]):
        mapping = map_columns(row)
        score = len(mapping)
        if "date" in mapping and ("debit" in mapping or "credit" in mapping
                                  or "amount" in mapping):
            score += 3
        if score > best_score:
            best_row, best_map, best_score = index, mapping, score

    if best_score < 3:
        return -1, {}
    return best_row, best_map


#: Money columns are numeric. A header containing any of these words describes
#: something else -- PhonePe's "Credit/debit instrument" holds "Credited to
#: 6272XXXXXXXX1009", which once matched "credit" and was read as a deposit.
_NOT_AN_AMOUNT = ("instrument", "type", "mode", "account", "card", "id", "remark")


def map_columns(header: list[str]) -> dict[str, int]:
    """Map header cells to fields.

    Exact matches win before substring matches, so a sheet with both "UTR" and
    "Transaction ID" picks UTR for the reference rather than whichever synonym
    happened to be longer.
    """
    mapping: dict[str, int] = {}
    used: set[int] = set()
    keys = [_key(cell) for cell in header]

    # Pass 1 -- exact equality, in each field's own preference order.
    for field_name, options in SYNONYMS.items():
        for option in options:
            for index, key in enumerate(keys):
                if index in used or not key:
                    continue
                if key == option:
                    mapping[field_name] = index
                    used.add(index)
                    break
            if field_name in mapping:
                break

    # Pass 2 -- substring, longest synonym first.
    pairs = sorted(
        ((option, field) for field, options in SYNONYMS.items() for option in options),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
    for option, field_name in pairs:
        if field_name in mapping or len(option) <= 4:
            continue
        for index, key in enumerate(keys):
            if index in used or not key or option not in key:
                continue
            if field_name in ("debit", "credit", "amount", "balance") and any(
                word in key for word in _NOT_AN_AMOUNT
            ):
                continue  # names a column about money, but does not hold money
            mapping[field_name] = index
            used.add(index)
            break
    return mapping


def verify_numeric_columns(
    grid: list[list[str]], header_row: int, mapping: dict[str, int]
) -> dict[str, int]:
    """Drop money mappings whose column does not actually contain money.

    Header text lies. Checking the data underneath is the only reliable way to
    tell an amount column from one that merely has "credit" in its name -- and a
    mis-mapped amount column corrupts every row without raising an error.
    """
    checked = dict(mapping)
    sample = [row for row in grid[header_row + 1: header_row + 26] if not _is_blank(row)]
    if not sample:
        return checked

    for field_name in ("debit", "credit", "amount", "balance"):
        index = checked.get(field_name)
        if index is None:
            continue
        seen = parsed = 0
        for row in sample:
            if index >= len(row):
                continue
            text = str(row[index] or "").strip()
            if not text:
                continue
            seen += 1
            if _amount_or_none(text, allow_negative=True) is not None:
                parsed += 1
        # A real amount column parses nearly always. Blank-heavy debit/credit
        # pairs are normal, so only judge the values that are actually present.
        if seen and parsed / seen < 0.6:
            del checked[field_name]
    return checked


# --------------------------------------------------------------------------
# value parsing
# --------------------------------------------------------------------------

def parse_date(text: str, formats: list[str] | None = None) -> date:
    raw = str(text or "").strip()
    if not raw:
        raise ValueError("empty date")

    # An Excel serial that slipped through as a bare number.
    if re.fullmatch(r"\d{5}", raw):
        from datetime import timedelta
        return date(1899, 12, 30) + timedelta(days=int(raw))

    raw = raw.split(" ")[0] if re.match(r"^\d{4}-\d{2}-\d{2} ", raw) else raw
    for fmt in (formats or []) + DATE_FORMATS:
        try:
            parsed = datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
        # Two-digit years: a bank statement is never from 1926.
        if parsed.year < 1970:
            parsed = parsed.replace(year=parsed.year + 100)
        return parsed
    raise ValueError(f"unrecognised date: {text!r}")


def _cell(row: list[str], mapping: dict[str, int], field_name: str) -> str:
    index = mapping.get(field_name)
    if index is None or index >= len(row):
        return ""
    return str(row[index] or "").strip()


def _is_blank(row: list[str]) -> bool:
    return not any(str(c or "").strip() for c in row)


# --------------------------------------------------------------------------
# the pipeline
# --------------------------------------------------------------------------

def parse_statement(
    data: bytes,
    filename: str,
    *,
    column_map: dict[str, int] | None = None,
    header_row: int | None = None,
    date_formats: list[str] | None = None,
) -> ParseResult:
    grid = load_grid(data, filename)
    if not grid:
        raise StatementError("That file has no rows.")

    if column_map is not None and header_row is not None:
        mapping, head = dict(column_map), header_row
    else:
        head, mapping = find_header(grid)
        if head >= 0:
            mapping = verify_numeric_columns(grid, head, mapping)

    preview = [[str(c) for c in row[:12]] for row in grid[: min(len(grid), 20)]]

    if head < 0 or not mapping:
        return ParseResult(
            rows=[], errors=[], header_row=-1,
            columns=[str(c) for c in (grid[0] if grid else [])],
            column_map={}, preview=preview, needs_mapping=True,
            warnings=["Could not recognise this layout. Map the columns to continue."],
        )

    columns = [str(c) for c in grid[head]]
    rows: list[RawRow] = []
    errors: list[dict] = []
    warnings: list[str] = []
    blanks = 0
    consecutive_failures = 0

    for index, row in enumerate(grid[head + 1:], start=head + 1):
        if _is_blank(row):
            blanks += 1
            if blanks >= 3 and rows:
                break  # footer reached
            continue
        blanks = 0

        # A lone banner line ("*** End of statement ***") is a footer, not a
        # broken transaction. Skip it silently rather than crying error.
        if sum(1 for cell in row if str(cell or "").strip()) < 2:
            continue

        try:
            rows.append(_parse_row(index, row, mapping, date_formats))
            consecutive_failures = 0
        except Exception as exc:  # noqa: BLE001 - one bad row must not kill the import
            consecutive_failures += 1
            # A run of unreadable rows after real data is the legal disclaimer,
            # not three hundred broken transactions.
            if consecutive_failures >= 3 and rows:
                del errors[-2:]
                break
            text = " ".join(str(c) for c in row if str(c).strip())[:120]
            if text:
                errors.append({"row_index": index, "error": str(exc), "text": text})

    if not rows:
        warnings.append("No transactions could be read. Check the column mapping.")

    _verify_balance_chain(rows, warnings)

    return ParseResult(
        rows=rows, errors=errors, header_row=head, columns=columns,
        column_map=mapping, preview=preview, warnings=warnings,
    )


def _parse_row(index: int, row: list[str], mapping: dict[str, int],
               date_formats: list[str] | None) -> RawRow:
    value_date = parse_date(_cell(row, mapping, "date"), date_formats)
    description = _cell(row, mapping, "description")

    debit_text = _cell(row, mapping, "debit")
    credit_text = _cell(row, mapping, "credit")
    amount_text = _cell(row, mapping, "amount")
    drcr = _cell(row, mapping, "drcr").upper()

    debit = _amount_or_none(debit_text)
    credit = _amount_or_none(credit_text)

    if debit and credit:
        raise ValueError("row has both a debit and a credit amount")

    if debit:
        direction, amount = "debit", debit
    elif credit:
        direction, amount = "credit", credit
    elif amount_text:
        value = _amount_or_none(amount_text, allow_negative=True)
        if value is None:
            raise ValueError("no amount on this row")
        if drcr.startswith("C") or "CR" in drcr:
            direction, amount = "credit", abs(value)
        elif drcr.startswith("D") or "DR" in drcr:
            direction, amount = "debit", abs(value)
        else:
            direction = "credit" if value > 0 else "debit"
            amount = abs(value)
    else:
        raise ValueError("no amount on this row")

    if amount == 0:
        raise ValueError("zero amount")

    balance_text = _cell(row, mapping, "balance")
    balance = _amount_or_none(balance_text, allow_negative=True)

    return RawRow(
        row_index=index,
        value_date=value_date,
        description=description,
        direction=direction,
        amount=amount,
        balance=balance,
        reference=_cell(row, mapping, "ref") or None,
        source_cells={"row": [str(c) for c in row[:12]]},
    )


def _amount_or_none(text: str, *, allow_negative: bool = False) -> int | None:
    text = (text or "").strip()
    if not text or text in {"-", "--", "0", "0.00", "0.0"}:
        return None
    try:
        value = to_paise(text)
    except MoneyError:
        return None
    if value == 0:
        return None
    return value if allow_negative else abs(value)


def _verify_balance_chain(rows: list[RawRow], warnings: list[str]) -> None:
    """If the statement carries a running balance, prove the rows are complete.

    A break means a parsing error or a missing row -- found here, before
    anything reaches the ledger, rather than at reconciliation three weeks later.
    """
    chain = [r for r in rows if r.balance is not None]
    if len(chain) < 2:
        return

    breaks = 0
    for previous, current in zip(chain, chain[1:]):
        delta = current.amount if current.direction == "credit" else -current.amount
        if previous.balance + delta != current.balance:
            breaks += 1

    if breaks:
        warnings.append(
            f"The running balance does not add up on {breaks} row"
            f"{'s' if breaks > 1 else ''}. Rows may be missing or misread — "
            "check the preview before committing."
        )
