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
  FlintChart,
  useInks,
  useMeasure,
} from '@df/chart';
import { format } from '@df/format';

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

// Papers per year as bars, the years NeurIPS met in one city bracketed above them; `range` keeps a
// stretch of years in full colour, `marks` labels a few bars with their papers.
function YearBars({ rows, range, marks = [] }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const height = 320;
  const top = 46;
  const x = d3.scaleBand().domain(rows.map(row => row.year)).range([36, Math.max(37, width)]).padding(0.18);
  const y = d3.scaleLinear().domain([0, d3.max(rows, row => row.papers) || 1]).nice().range([height - 22, top]);
  // Runs of years in one city, for the brackets.
  const runs = [];
  rows.forEach(row => {
    const last = runs[runs.length - 1];
    if (last && last.city === row.city) last.to = row.year;
    else runs.push({ city: row.city, from: row.year, to: row.year });
  });
  const inside = year => !range || (year >= range[0] && year <= range[1]);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} fontSize={11} role="img" aria-label="Papers per year">
          {y.ticks(4).map(tick => (
            <g key={tick} transform={`translate(0,${y(tick)})`}>
              <line x1={36} x2={width} stroke={inks.grid} />
              <text x={30} dy="0.35em" textAnchor="end" fill={inks.muted}>{format.compact(tick)}</text>
            </g>
          ))}
          {rows.map(row => (
            <Tooltip key={row.year} title={`${row.year}, ${row.city}: ${format.number(row.papers, 0)} papers`}>
              <rect
                x={x(row.year)}
                y={y(row.papers)}
                width={x.bandwidth()}
                height={y(0) - y(row.papers)}
                rx={1.5}
                fill={inside(row.year) ? inks.accent : inks.faint}
                style={{ transition: 'fill 500ms' }}
              />
            </Tooltip>
          ))}
          {rows.filter(row => marks.includes(row.year)).map(row => (
            <text key={`mark-${row.year}`} x={x(row.year) + x.bandwidth() / 2} y={y(row.papers) - 6}
              textAnchor={x(row.year) < width / 3 ? 'start' : 'end'} fontSize={12} fontWeight={600} fill={inks.text}>
              {`${format.number(row.papers, 0)} in ${row.year}`}
            </text>
          ))}
          {runs.filter(run => run.to - run.from >= 1 || run.from >= 2024).map(run => {
            const x0 = x(run.from);
            const x1 = x(run.to) + x.bandwidth();
            const on = !range || (run.to >= range[0] && run.from <= range[1]);
            return (
              <g key={`${run.city}-${run.from}`} opacity={on ? 1 : 0.35}>
                <path d={`M${x0},${top - 8}V${top - 14}H${x1}V${top - 8}`} fill="none" stroke={inks.muted} />
                <text x={(x0 + x1) / 2} y={top - 20} textAnchor="middle" fill={inks.text}>
                  {x1 - x0 > run.city.length * 6 ? run.city : ''}
                </text>
              </g>
            );
          })}
          <text x={x(rows[0]?.year) || 36} y={height - 6} fill={inks.muted}>{rows[0]?.year}</text>
          <text x={width} y={height - 6} textAnchor="end" fill={inks.muted}>{rows[rows.length - 1]?.year}</text>
        </svg>
      )}
    </div>
  );
}

export default function App() {
  const years = useQuery('papers_per_year', { orderBy: 'year' });
  const rows = years.rows;
  const at = year => rows.find(row => row.year === year) || {};
  const first = rows[0] || {};
  const last = rows[rows.length - 1] || {};
  const thousand = rows.find(row => row.papers >= 1000) || {};
  const denver = rows.filter(row => row.city === 'Denver');
  const steps = [
    {
      title: `${first.year}: ${format.number(first.papers, 0)} papers in ${first.city}`,
      text: `NeurIPS met in Denver for its first ${denver.length} years, with 90 to `
        + `${format.number(d3.max(denver, row => row.papers) || 0, 0)} papers a year: a meeting of `
        + 'neuroscientists, physicists and engineers interested in neural networks.',
      range: [first.year, denver[denver.length - 1]?.year],
      marks: [first.year],
    },
    {
      title: 'A steady climb',
      text: `In Vancouver from 2001, then Granada, Lake Tahoe and Montréal, the conference grew slowly: `
        + `${format.number(at(2001).papers, 0)} papers in 2001, ${format.number(at(2012).papers, 0)} in 2012.`,
      range: [2001, 2012],
      marks: [2012],
    },
    {
      title: 'The deep learning boom',
      text: `Then papers grew ${format.number(at(2019).papers / (at(2013).papers || 1), 1)} times over in six years, `
        + `from ${format.number(at(2013).papers, 0)} in 2013, passing 1,000 for the first time in ${thousand.year} `
        + `(${format.number(thousand.papers, 0)}) as deep learning took off.`,
      range: [2013, 2019],
      marks: [thousand.year],
    },
    {
      title: `${format.number(last.papers, 0)} papers in ${last.year}`,
      text: `After two years online, NeurIPS kept growing: ${format.number(last.papers, 0)} papers in `
        + `${last.year}, ${format.number(last.papers / (first.papers || 1), 0)} times the first conference, `
        + 'shown in Sydney, Atlanta and Paris.',
      range: [2020, last.year],
      marks: [last.year],
    },
  ];

  return (
    <AppTheme theme="neurips-df" density="normal">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={5}>
          <AppHeader
            variant="editorial"
            kicker="NeurIPS over the years"
            title={`From ${format.number(first.papers, 0)} papers to ${format.number(last.papers, 0)}`}
            deck="How NeurIPS grew from a small meeting in Denver to a conference in three cities."
            source="__SOURCE__"
          />
          {steps.map(item => (
            <Step key={item.title} title={item.title} text={item.text}>
              <YearBars rows={rows} range={item.range} marks={item.marks} />
            </Step>
          ))}
          <Step
            title="Bigger teams"
            text={`Papers are written by more people too: ${format.number(last.authors_per_paper, 1)} authors `
              + `on average in ${last.year}, against ${format.number(first.authors_per_paper, 1)} in ${first.year}.`}
          >
            <FlintChart
              chartType="Line Chart"
              query={years}
              height={300}
              encodings={{ x: 'year', y: 'authors_per_paper' }}
              semanticTypes={{ year: 'Year' }}
              labels={{ year: '', authors_per_paper: 'Authors per paper' }}
              focus={{ year: last.year }}
              note={`${format.number(last.authors_per_paper, 1)} authors`}
            />
          </Step>
        </Stack>
      </Container>
    </AppTheme>
  );
}
