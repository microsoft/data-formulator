--- Pandoc Lua Filter: caption-labels.lua
--- Auto-numbers figures and tables with consistent labels.
---
--- Converts:
---   ![Description](image.png) → Figure N: Description
---   Table captions with auto-numbering
---
--- Usage:
---   pandoc input.md -o output.docx --lua-filter=caption-labels.lua

local figure_count = 0
local table_count = 0

function Image(el)
  if el.caption and #el.caption > 0 then
    figure_count = figure_count + 1
    local label = pandoc.Str("Figure " .. figure_count .. ": ")
    local bold_label = pandoc.Strong({label})
    table.insert(el.caption, 1, bold_label)
  end
  return el
end

function Table(el)
  if el.caption and el.caption.long and #el.caption.long > 0 then
    table_count = table_count + 1
    local first_block = el.caption.long[1]
    if first_block and first_block.content then
      local label = pandoc.Str("Table " .. table_count .. ": ")
      local bold_label = pandoc.Strong({label})
      table.insert(first_block.content, 1, bold_label)
    end
  end
  return el
end
