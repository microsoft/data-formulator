import { useMemo } from 'react';
import {
  Container,
  Grid,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import * as d3 from 'd3';
import { useQuery } from '@df/data';
import {
  AppHeader,
  AppTheme,
  DataTable,
  FlintChart,
  useInks,
  useMeasure,
} from '@df/chart';
import { format } from '@df/format';

const CITIES = ['Sydney', 'Atlanta', 'Paris'];
const DOT = 5;
const GAP = 3;

// One step: its text beside its picture.
function Step({ title, text, children }) {
  return (
    <Grid container spacing={4} alignItems="center">
      <Grid size={{ xs: 12, md: 4 }}>
        <Stack spacing={1.5}>
          <Typography variant="h5" component="h2">{title}</Typography>
          <Typography sx={{ fontSize: '1.0625rem', lineHeight: 1.65 }}>{text}</Typography>
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>{children}</Grid>
    </Grid>
  );
}

// One dot per paper (orals and spotlights ringed), all together or in groups (`by`: topic area or city),
// coloured by topic area once grouped. Dots glide to their new places as the grouping changes.
function PaperDots({ rows, by, areas }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const step = DOT * 2 + GAP;
  const layout = useMemo(() => {
    if (!width) return { dots: [], labels: [], height: 0 };
    const keyOf = row => (by === 'area' ? row.topic_area || 'No topic' : by === 'city' ? row.city || 'Elsewhere' : 'all');
    const groups = d3.groupSort(rows, items => -items.length, keyOf)
      .map(key => ({ key, items: rows.filter(row => keyOf(row) === key) }));
    if (by === 'city') groups.sort((a, b) => CITIES.indexOf(a.key) - CITIES.indexOf(b.key));
    const columns = by ? Math.max(4, Math.floor(Math.sqrt(d3.max(groups, group => group.items.length)) * 1.4)) :
      Math.floor(width / step);
    // A group's block is as wide as its dots or its label, whichever is wider.
    const blockWidth = group => Math.max(columns * step, (group.key.length + 5) * 7) + 24;
    const dots = [];
    const labels = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    groups.forEach(group => {
      if (x + blockWidth(group) > width && x > 0) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      const top = by ? 20 : 0;
      if (by) labels.push({ key: group.key, n: group.items.length, x, y: y + 12 });
      group.items.forEach((row, index) => dots.push({
        row,
        x: x + (index % columns) * step + DOT,
        y: y + top + Math.floor(index / columns) * step + DOT,
      }));
      rowHeight = Math.max(rowHeight, top + Math.ceil(group.items.length / columns) * step + 18);
      x += blockWidth(group);
    });
    return { dots, labels, height: y + rowHeight };
  }, [rows, by, width, step]);
  const colour = row => (by ? inks.palette[Math.max(0, areas.indexOf(row.topic_area)) % inks.palette.length] : inks.accent);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={Math.max(60, layout.height)} role="img" aria-label="Microsoft papers">
          {layout.labels.map(label => (
            <text key={label.key} x={label.x} y={label.y} fontSize={12} fontWeight={600} fill={inks.text}>
              {`${label.key} · ${label.n}`}
            </text>
          ))}
          {layout.dots.map(dot => (
            <Tooltip key={dot.row.paper_id} title={`${dot.row.title} (${dot.row.topic_area || 'no topic'})`}>
              <circle
                r={DOT}
                fill={colour(dot.row)}
                stroke={dot.row.presentation === 'Poster' ? 'none' : inks.text}
                strokeWidth={1.5}
                style={{ transform: `translate(${dot.x}px, ${dot.y}px)`, transition: 'transform 800ms, fill 800ms' }}
              />
            </Tooltip>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function App() {
  const papers = useQuery('microsoft_papers_2026', { orderBy: ['day', 'starts', 'city', 'poster_position'] });
  const years = useQuery('microsoft_by_year', { orderBy: 'year' });
  const rows = papers.rows;
  const areas = d3.groupSort(rows.filter(row => row.topic_area), items => -items.length, row => row.topic_area);
  const count = (field, value) => rows.filter(row => row[field] === value).length;
  const highlighted = rows.filter(row => row.presentation !== 'Poster').length;
  const last = years.rows[years.rows.length - 1] || {};
  const base = years.rows.find(row => row.year === 2010) || {};
  const peak = years.rows.reduce((best, row) => (!best || row.share > best.share ? row : best), null) || {};

  return (
    <AppTheme theme="neurips-df" density="normal">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={5}>
          <AppHeader
            variant="editorial"
            kicker="Microsoft at NeurIPS"
            title={`${rows.length} NeurIPS 2026 papers have Microsoft authors`}
            deck={'Papers with at least one author at Microsoft, its research labs or its companies (GitHub, '
              + 'LinkedIn), what they are about, and where to see them.'}
            source="__SOURCE__"
          />
          <Step
            title={`${rows.length} papers`}
            text={`Each dot is one NeurIPS 2026 paper with a Microsoft author; the ${highlighted} ringed ones are `
              + 'orals or spotlights.'}
          >
            <PaperDots rows={rows} areas={areas} />
          </Step>
          <Step
            title="What they are about"
            text={`By the topic area their authors chose: ${areas.slice(0, 3)
              .map(area => `${area.toLowerCase()} (${count('topic_area', area)})`).join(', ')} lead.`}
          >
            <PaperDots rows={rows} areas={areas} by="area" />
          </Step>
          <Step
            title="Where to see them"
            text={`${CITIES.map(city => `${count('city', city)} in ${city}`).join(', ')}. The table below has every `
              + 'paper with its day, local time and poster number.'}
          >
            <PaperDots rows={rows} areas={areas} by="city" />
          </Step>
          <Step
            title="Over the years"
            text={`Microsoft authors were on ${format.number(base.papers || 0, 0)} NeurIPS papers in 2010 and are on `
              + `${format.number(last.papers || 0, 0)} in ${last.year}. As NeurIPS grew faster still, their share `
              + `peaked at ${format.number(peak.share || 0, 1)}% in ${peak.year}.`}
          >
            <FlintChart
              chartType="Line Chart"
              query={years}
              height={300}
              encodings={{ x: 'year', y: 'papers' }}
              semanticTypes={{ year: 'Year' }}
              labels={{ year: '', papers: 'Papers with Microsoft authors' }}
              focus={{ year: last.year }}
              note={`${format.number(last.papers || 0, 0)} papers`}
            />
          </Step>
          <Stack spacing={1.5}>
            <Typography variant="h5" component="h2">Every paper, and when to see it</Typography>
            <DataTable
              query={papers}
              groupBy="city"
              maxHeight={520}
              columns={[
                { field: 'day', label: 'Day', format: 'date' },
                { field: 'starts', label: 'Starts' },
                { field: 'poster_position', label: 'Poster' },
                { field: 'title', label: 'Title' },
                { field: 'microsoft_teams', label: 'Microsoft teams' },
              ]}
            />
          </Stack>
        </Stack>
      </Container>
    </AppTheme>
  );
}
