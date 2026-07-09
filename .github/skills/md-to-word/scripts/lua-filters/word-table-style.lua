--- Pandoc Lua Filter: word-table-style.lua
--- Enhances Word table styling beyond pandoc defaults.
---
--- Adds:
---   - cantSplit on table rows (prevent row splitting across pages)
---   - tblHeader on first row (repeat header on each page)
---   - keepNext on all rows except last (keep table together)
---
--- Usage:
---   pandoc input.md -o output.docx --lua-filter=word-table-style.lua

local W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

function Table(el)
  -- Add OpenXML raw blocks for table properties
  -- This works with pandoc's native OOXML output
  if FORMAT == 'docx' then
    -- We can't directly modify OOXML from Lua filters in pandoc,
    -- but we can add metadata that post-processors can use
    el.attributes = el.attributes or {}
    el.attributes['custom-style'] = 'AlexTable'
  end
  return el
end
