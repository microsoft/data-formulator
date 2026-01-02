# System Architecture Diagram

## Export Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                               │
│                    (ReportView.tsx - React)                         │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 1. Component Mounts                                        │   │
│  │    → useEffect loads available templates                  │   │
│  │    → Calls GET /api/export/list-templates                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 2. Display Template Selector                               │   │
│  │    ┌──────────────────────────────────────────────────┐   │   │
│  │    │ Select PowerPoint template for export       ▼   │   │   │
│  │    │ ┌──────────────────────────────────────────────┐ │   │   │
│  │    │ │ HOYA MD Template v4 (selected)          ✓   │ │   │   │
│  │    │ │ Company Template Blue                       │ │   │   │
│  │    │ │ Annual Report Template                      │ │   │   │
│  │    │ └──────────────────────────────────────────────┘ │   │   │
│  │    └──────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 3. User Clicks "Export to PowerPoint"                     │   │
│  │    → Captures report as PNG image                         │   │
│  │    → Prepares form data with:                            │   │
│  │       - image: PNG blob                                  │   │
│  │       - template: selected template filename             │   │
│  │       - title: report title                              │   │
│  │    → POST /api/export/pptx                               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  ║
                         HTTP POST ║
                                  ║
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND API                                    │
│                 (Flask / export_routes.py)                          │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 4. Endpoint: POST /api/export/pptx                        │   │
│  │    Receives:                                              │   │
│  │    - image: PNG file bytes                                │   │
│  │    - template: filename                                   │   │
│  │    - title: text                                          │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 5. Load Template from Filesystem                          │   │
│  │    Search directories in order:                           │   │
│  │    1. ppt_templates/ (recommended)                        │   │
│  │    2. templates/                                          │   │
│  │    3. py-src/ppt_templates/                               │   │
│  │    4. project root                                        │   │
│  │    5. working directory                                   │   │
│  │                                                            │   │
│  │    Using: python-pptx library                             │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 6. Process Report                                         │   │
│  │    a) Add new slide to template                           │   │
│  │       → Use blank layout (layout 6 or 0)                  │   │
│  │    b) Insert report image                                 │   │
│  │       → Scale to fit slide                                │   │
│  │       → Center with margins                               │   │
│  │    c) Add title textbox                                   │   │
│  │       → Position at top                                   │   │
│  │       → Max 200 characters                                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 7. Save and Return                                        │   │
│  │    → Save modified PPTX to BytesIO                        │   │
│  │    → Generate filename: report-TIMESTAMP.pptx             │   │
│  │    → Return as download                                   │   │
│  │    → Content-Type: application/vnd.pptx                  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  ║
                      HTTP Response (file)
                                  ║
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      BROWSER                                        │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 8. Download Complete                                      │   │
│  │    → File saved to Downloads folder                       │   │
│  │    → Filename: report-TIMESTAMP.pptx                      │   │
│  │    → Shows: "Export successful" message                   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ 9. User Opens File in PowerPoint                          │   │
│  │    Original Template + New Report Slide                   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Template Discovery

```
┌─────────────────────────────────────────────────────┐
│       GET /api/export/list-templates                │
│         (Frontend loads templates)                  │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│         Backend Searches Template Dirs              │
│                                                     │
│  Priority Order (first match wins):                │
│  1. ppt_templates/                ← RECOMMENDED    │
│  2. templates/                                      │
│  3. py-src/ppt_templates/                           │
│  4. py-src/                                         │
│  5. data-formulator/                                │
│  6. project root/                                   │
│  7. working directory/                              │
│                                                     │
│  Pattern: *.pptx                                    │
│  Duplicates eliminated (using set)                  │
│  Results sorted alphabetically                      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│         Return JSON Response                        │
│                                                     │
│  {                                                  │
│    "status": "success",                            │
│    "templates": [                                   │
│      "HOYA MD Template v4.pptx",                   │
│      "Company Template Blue.pptx",                  │
│      "Annual Report.pptx"                           │
│    ]                                                │
│  }                                                  │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│      Frontend Populates Dropdown                    │
│                                                     │
│   [Select template ▼]                              │
│    ├─ HOYA MD Template v4.pptx (selected)         │
│    ├─ Company Template Blue.pptx                   │
│    └─ Annual Report.pptx                           │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
data-formulator/
│
├── ppt_templates/              ← RECOMMENDED location for templates
│   ├── HOYA MD Presentation Template v4 20241126 Internal.pptx
│   ├── Company_Template_Blue.pptx
│   ├── Annual_Report_Template.pptx
│   └── Quarterly_Briefing.pptx
│
├── templates/                  ← Alternative location (lower priority)
│
├── src/
│   └── views/
│       └── ReportView.tsx      ← Modified (template selector UI)
│
├── py-src/
│   └── data_formulator/
│       └── export_routes.py    ← Modified (new list-templates endpoint)
│
├── PPTX_TEMPLATE_GUIDE.md      ← NEW (comprehensive guide)
├── TEMPLATE_QUICKSTART.md      ← NEW (quick reference)
└── IMPLEMENTATION_SUMMARY.md   ← NEW (technical details)
```

## Component Interaction

```
┌──────────────────────────────────────────────────────────┐
│                   ReportView.tsx                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  State:                                                  │
│  ├── selectedTemplate: string                           │
│  ├── availableTemplates: string[]                       │
│  └── isExporting: boolean                               │
│                                                          │
│  Effects:                                                │
│  ├── loadTemplates() → fetch /api/export/list-templates│
│  └── Update availableTemplates on mount                │
│                                                          │
│  Functions:                                              │
│  └── exportToPowerPoint()                               │
│      └── form.append("template", selectedTemplate)     │
│      └── POST /api/export/pptx                         │
│                                                          │
│  UI:                                                     │
│  ├── <Select>                                           │
│  │   ├── value={selectedTemplate}                      │
│  │   ├── onChange={setSelectedTemplate}                │
│  │   └── <MenuItem> for each availableTemplate         │
│  │                                                      │
│  └── <Button>                                           │
│      └── onClick={exportToPowerPoint}                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │   /api/export/list-templates  │
        │   (GET)                       │
        └───────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │   /api/export/pptx            │
        │   (POST)                      │
        │                               │
        │   Input:                      │
        │   - image: Blob               │
        │   - template: string (DYNAMIC)│
        │   - title: string             │
        │                               │
        │   Process:                    │
        │   1. Load template file       │
        │   2. Add slide                │
        │   3. Insert image             │
        │   4. Add title                │
        │   5. Save & return            │
        │                               │
        │   Output:                     │
        │   - PPTX file (download)      │
        └───────────────────────────────┘
```

## Data Flow: Detailed

```
FRONTEND                          BACKEND                    FILESYSTEM
┌──────────┐                   ┌──────────┐               ┌─────────────┐
│ Component│                   │  Route   │               │ Templates   │
│  Mounted │                   │          │               │ Directory   │
└─────┬────┘                   └──────────┘               └─────────────┘
      │                                                           │
      │─────── GET /api/export/list-templates ────────────────→ │
      │                                                           │
      │                          ← list all *.pptx files ──────→ │
      │                                                           │
      │← JSON response with template list ──────────────────────│
      │                                                           │
      │ (Display dropdown with templates)                         │
      │                                                           │
      │ (User selects template)                                  │
      │                                                           │
      │─────── Report Image + Template Name ──────────────────→ │
      │  POST /api/export/pptx                                   │
      │  {                                                        │
      │    image: PNG bytes                                       │
      │    template: "Company_Template_Blue.pptx" ───────────→  │
      │    title: "Q4 Sales Report"                              │
      │  }                                                        │
      │                                                           │
      │                          ← load template file ────────→  │
      │                                                           │
      │                    Modify PPTX                            │
      │                    (add slide, image, title)              │
      │                                                           │
      │← Save PPTX file (download) ──────────────────────────────│
      │
      │ (Browser downloads file)
      │
   [DONE]
```

---

**System Type**: Export/Download Pipeline
**Architecture**: Request-Response (HTTP)
**Backend Language**: Python (Flask)
**Frontend Framework**: React (TypeScript)
**File Format**: PPTX (Office Open XML)
**Dependencies**: python-pptx, PIL, html2canvas, vega-embed
