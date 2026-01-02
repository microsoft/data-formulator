# Quick Start: Using PowerPoint Templates

## Setup (5 minutes)

### 1. Create template directory

```bash
mkdir -p data-formulator/ppt_templates
```

### 2. Place your template file

Copy your PowerPoint file to the templates folder:

```
data-formulator/ppt_templates/
└── HOYA MD Presentation Template v4 20241126 Internal.pptx
```

### 3. Restart backend (if running)

The system automatically detects new templates. If already running, restart for changes to take effect.

## Using Templates (3 steps)

### Step 1: Open Report View

Navigate to the **Report** tab in Data Formulator

### Step 2: Select Template

Use the dropdown menu to choose your template:

```
[Select PowerPoint template for export ▼]
  HOYA MD Presentation Template v4 20241126 Internal.pptx
```

### Step 3: Export

Click **"Export to PowerPoint"** and download your file

## Multiple Templates

Add multiple templates to `ppt_templates/`:

```
ppt_templates/
├── Template_A.pptx
├── Template_B.pptx
└── Template_C.pptx
```

Each export lets you choose which template to use.

## What Happens

1. Your report is captured as an image
2. Selected template is loaded
3. New slide is added to template
4. Your report image is inserted and centered
5. Report title is added
6. Modified file downloads to your computer

The original template file is never modified.

## Troubleshooting

**Template not in dropdown?**

- Verify file is named `*.pptx`
- Check it's in `data-formulator/ppt_templates/`
- Restart backend if recently added

**Export fails?**

- Verify template file is valid (open in PowerPoint)
- Check file permissions
- Try a different template to isolate issue

## See Also

- Full guide: [PPTX_TEMPLATE_GUIDE.md](PPTX_TEMPLATE_GUIDE.md)
- Technical details: [py-src/data_formulator/export_routes.py](py-src/data_formulator/export_routes.py)
