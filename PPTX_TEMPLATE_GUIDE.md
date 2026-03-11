# PowerPoint Template Export Guide

## Overview

GDIS AI Agent now supports exporting reports directly to existing PowerPoint templates. This allows you to maintain consistent branding, layouts, and formatting across all generated reports.

## How It Works

### System Architecture

1. **Frontend** ([src/views/ReportView.tsx](src/views/ReportView.tsx)):

   - Captures your report as an image
   - Loads available templates from the server
   - Allows you to select a template before export
   - Sends the image and selected template to the backend

2. **Backend** ([py-src/data_formulator/export_routes.py](py-src/data_formulator/export_routes.py)):
   - Lists available PPTX templates from configured directories
   - Loads your selected template
   - Inserts the report image into an appropriate slide
   - Adds a title textbox with the report name
   - Returns the modified PPTX file for download

## Setting Up Templates

### Step 1: Prepare Your PowerPoint Template

Create or prepare a PowerPoint file with your desired layout, branding, and styling. The system will:

- Add a new slide to your template using a blank layout
- Insert your report image on that slide
- Add the report title as text

**Note**: The template must be a valid PPTX file.

### Step 2: Place Template in One of These Directories

The system searches for templates in the following locations (in order):

```
Priority 1 (Recommended):
  data-formulator/ppt_templates/

Priority 2:
  data-formulator/templates/

Priority 3 (Fallback):
  py-src/ppt_templates/
  data-formulator/ (root)
  (and other project directories)
```

**Best Practice**: Create a `ppt_templates` folder at the project root:

```bash
mkdir -p data-formulator/ppt_templates
```

Then place your template file there:

```
data-formulator/
├── ppt_templates/
│   ├── HOYA MD Presentation Template v4 20241126 Internal.pptx
│   ├── Company_Template_Blue.pptx
│   ├── Annual_Report_Template.pptx
│   └── Quarterly_Briefing.pptx
├── src/
├── py-src/
└── ...
```

### Step 3: Restart the Backend (if needed)

If the backend is already running, you may need to restart it for the template list to refresh. Most changes should be picked up automatically on the next export action.

## Using Templates in the Application

### 1. Navigate to the Report View

In the GDIS AI Agent interface, go to the **Report** view.

### 2. Select Your Template

Before exporting, you'll see a dropdown menu with all available templates:

```
[Select PowerPoint template for export ▼]
  HOYA MD Presentation Template v4 20241126 Internal.pptx
  Company_Template_Blue.pptx
  Annual_Report_Template.pptx
  Quarterly_Briefing.pptx
```

Choose your desired template.

### 3. Click "Export to PowerPoint"

The system will:

1. Capture your report as a high-quality image
2. Load your selected template
3. Add a new slide with the report image
4. Insert the report title
5. Download the modified PPTX file

## Technical Details

### What Gets Added to Your Template

When you export a report to a template, the system:

1. **Loads** your template file
2. **Adds a new slide** using the template's blank layout (or layout 6, with fallback to layout 0)
3. **Inserts the report image**:
   - Scales the image to fit the slide while preserving aspect ratio
   - Leaves 0.5-inch margins on all sides
   - Centers the image on the slide
4. **Adds a title textbox**:
   - Positioned at the top of the slide
   - Contains the report title (max 200 characters)
   - Uses 18pt font size

### Supported Slide Layouts

The system automatically selects the most appropriate blank slide layout:

- **Preferred**: Layout 6 (if available)
- **Fallback**: Layout 0 (blank)

If your template has custom layouts, the blank layout will be used. The report image will be scaled to fit properly with appropriate margins.

### Image Specifications

- **Format**: PNG (24-bit with alpha channel)
- **DPI**: 96 DPI assumed for sizing calculations
- **Quality**: 0.95 compression (high quality)
- **Dimensions**: Depends on report content, typically 1200-1600px wide

## Common Use Cases

### Use Case 1: Corporate Branding

Create a template with your company logo, standard fonts, and color scheme:

```
Template: Corporate_Report_2024.pptx
├── Slide 1: Title slide with logo and company info
├── Slide 2: [Report will be added here]
├── Slide 3: Footer slide with legal disclaimers
└── Design: Consistent fonts, colors, and spacing
```

When exporting, your report maintains the overall design consistency.

### Use Case 2: Department-Specific Templates

Create separate templates for different departments:

```
ppt_templates/
├── Marketing_Report_Template.pptx
├── Sales_Analysis_Template.pptx
├── Operations_Dashboard_Template.pptx
└── Finance_Summary_Template.pptx
```

Select the appropriate template based on the report type.

### Use Case 3: Quarterly Business Reviews

Create a template with predefined sections:

```
Template: Q4_2024_Review.pptx
├── Slide 1: Q4 2024 Analysis
├── Slide 2: [Your report data will be added here]
├── Slide 3: Key Metrics Summary
├── Slide 4: Action Items
└── Slide 5: Appendix
```

### Use Case 4: Client Presentations

Maintain client-specific templates:

```
ppt_templates/
├── Client_Acme_Corp_Template.pptx
├── Client_Global_Industries_Template.pptx
└── Client_TechStart_Template.pptx
```

Each template contains client logos, color schemes, and branding.

## Troubleshooting

### Template Not Found in Dropdown

**Problem**: Your template file isn't appearing in the template selector.

**Solutions**:

1. Verify the file is named correctly (case-sensitive on Linux/Mac)
2. Verify the file is a valid `.pptx` file
3. Ensure it's in one of the search directories listed above
4. Restart the backend server
5. Check server logs for any errors: `grep -i "template\|pptx" backend.log`

### Export Fails with Template Error

**Problem**: "Template not found" error during export.

**Solutions**:

1. Verify the template file exists in the expected location
2. Check file permissions (ensure the backend can read the file)
3. Validate the PPTX file is not corrupted:
   - Open it in PowerPoint/LibreOffice to verify
   - Try a different template to isolate the issue
4. Check server logs for detailed error messages

### Image Not Appearing on Slide

**Problem**: The report image appears blank or corrupted in the output PPTX.

**Solutions**:

1. Try exporting again (temporary issue)
2. Ensure your report content is visible before exporting
3. Check that the slide layout supports image insertion
4. Try a different template to isolate the issue

### Title Text Truncated or Misaligned

**Problem**: The report title appears cut off or is positioned incorrectly.

**Solutions**:

1. The title is limited to 200 characters (by design)
2. The textbox size is fixed at 0.5 inches tall
3. Create a custom template with a larger title area if needed
4. Use shorter report titles

## Advanced: Creating Custom Templates

### Best Practices for Template Design

1. **Blank Slide Design**:

   - Ensure slide 6 (or slide 0) is truly blank
   - Test by adding content to verify positioning

2. **Margins and Spacing**:

   - Leave adequate space for image insertion
   - Consider 0.5-inch margins when designing

3. **Color and Fonts**:

   - Use standard, widely-available fonts
   - Ensure sufficient contrast for text readability

4. **Aspect Ratio**:
   - Standard: 16:9 (modern presentations)
   - Alternative: 4:3 (legacy, wider reports)

### Template File Structure

A PPTX file is actually a ZIP archive containing XML files. Advanced users can:

1. Extract the PPTX: `unzip template.pptx -d template_dir/`
2. Edit XML files directly for precise control
3. Repackage: `cd template_dir && zip -r ../template.pptx *`

Common files to modify:

- `ppt/slides/slide1.xml` - Slide content
- `ppt/slideLayouts/slideLayout7.xml` - Layout definitions
- `ppt/theme/theme1.xml` - Color scheme and fonts

## API Reference

### List Available Templates

**Endpoint**: `GET /api/export/list-templates`

**Response**:

```json
{
  "status": "success",
  "templates": [
    "HOYA MD Presentation Template v4 20241126 Internal.pptx",
    "Company_Template_Blue.pptx",
    "Annual_Report_Template.pptx"
  ]
}
```

### Export Report with Template

**Endpoint**: `POST /api/export/pptx`

**Parameters** (multipart/form-data):

- `image` (required): PNG image of the report
- `template` (optional): Name of the template file (e.g., "Company_Template_Blue.pptx")
- `title` (optional): Report title for the textbox (max 200 characters)

**Response**:

- Success (200): Downloads the modified PPTX file
- Error (400): Template not found or invalid image
- Error (500): Processing error

## FAQ

**Q: Can I have multiple templates?**
A: Yes! Place multiple PPTX files in the `ppt_templates` folder and select which one to use before exporting.

**Q: Will the template layout be preserved?**
A: Yes. The template file remains unchanged. Only a new slide is added to the existing template with your report image.

**Q: Can I customize where the image is placed on the slide?**
A: Currently, the image is centered with 0.5-inch margins. For advanced customization, you can edit the backend code in `export_routes.py` (lines 50-100 handle image placement).

**Q: What slide layouts work best?**
A: Blank layouts (layout 0 or 6) work best. The system automatically selects the appropriate blank layout from your template.

**Q: Can I add custom elements to the slide programmatically?**
A: Yes. Modify `export_routes.py` to add shapes, text boxes, or other elements after inserting the image.

**Q: Is there a limit on template file size?**
A: No hard limit, but very large templates (>50MB) may slow down processing. Keep templates under 10MB for best performance.

## For Developers

### Extending the System

To customize how templates are processed, edit `py-src/data_formulator/export_routes.py`:

1. **Change slide layout selection** (line ~70):

   ```python
   layout_idx = 6 if len(prs.slide_layouts) > 6 else 0
   ```

2. **Modify image positioning** (lines ~100-110):

   ```python
   left = (slide_width_in - final_w) / 2
   top = (slide_height_in - final_h) / 2
   ```

3. **Customize title formatting** (lines ~115-120):

   ```python
   p.font.size = Pt(18)
   p.font.bold = True
   ```

4. **Add additional elements** (after line ~120):
   ```python
   # Add company logo, footer, etc.
   slide.shapes.add_picture("logo.png", Inches(0.5), Inches(6.5), width=Inches(1))
   ```

### Required Dependencies

The backend uses:

- `python-pptx`: PowerPoint file manipulation
- `Pillow`: Image processing

Both are listed in `requirements.txt`.

## Support

For issues or questions:

1. Check this guide's Troubleshooting section
2. Review server logs for error messages
3. Verify template file integrity and permissions
4. Test with a simple template first
5. Open an issue on the project repository

---

**Last Updated**: January 2026
**Version**: 2.0 (with template selection UI)
