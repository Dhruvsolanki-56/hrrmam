"""Excel export of the project list (same filters as the screen)."""
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from . import workflow
from .models import Project, aware

STATUS = {"active": "In progress", "on_hold": "On hold", "clarification": "Clarification",
          "rejected": "Rejected", "completed": "Completed"}

HEAD = ["Code", "Project", "Type", "Category", "Initiator", "Stage #", "Stage", "Also active (parallel)", "Entity", "Approver",
        "Status", "Days in stage", "Target days", "Overdue", "Started", "Last updated"]


def build_xlsx(projects: list[Project]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Projects"
    ws.append(HEAD)
    for p in projects:
        s = workflow.stage(p.stage_key)
        closed = p.status in ("rejected", "completed")
        ws.append([
            p.code or "Pending", p.name, p.project_type, p.category, p.initiator,
            workflow.STAGE_INDEX[p.stage_key] + 1, s.name,
            ", ".join(workflow.stage(k).name for k in p.active_keys if k != p.stage_key), s.entity, s.approver,
            STATUS[p.display_status],
            None if closed else p.days_in_stage, None if closed else p.sla_days,
            "Yes" if p.overdue else "No",
            aware(p.created_at).date(), aware(p.updated_at).date(),
        ])
    fill = PatternFill("solid", fgColor="004248")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = fill
        c.alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 24
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions
    widths = [14, 40, 13, 18, 18, 8, 26, 30, 26, 34, 14, 13, 12, 9, 12, 13]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    red = Font(bold=True, color="A1260E")
    for row in ws.iter_rows(min_row=2):
        if row[13].value == "Yes":
            row[13].font = red
        for c in row[14:16]:
            c.number_format = "dd mmm yyyy"
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
