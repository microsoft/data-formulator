--- Pandoc Lua Filter: keep-headings.lua
--- Ported from AIRS_Data_Analysis defence/exports pattern
---
--- Prevents heading orphans by inserting \Needspace before headings
--- and optional \clearpage before H1 (chapter breaks).
---
--- Usage:
---   pandoc input.md -o output.docx --lua-filter=keep-headings.lua
---   pandoc input.md -o output.pdf --lua-filter=keep-headings.lua

function Header(el)
  -- H1: force page break before (chapter-level)
  if el.level == 1 then
    return {
      pandoc.RawBlock('latex', '\\clearpage'),
      pandoc.RawBlock('openxml', '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'),
      el
    }
  end

  -- H2-H3: ensure enough space for heading + first paragraph
  if el.level == 2 or el.level == 3 then
    local space = el.level == 2 and '3cm' or '2cm'
    return {
      pandoc.RawBlock('latex', '\\needspace{' .. space .. '}'),
      el
    }
  end

  return el
end
