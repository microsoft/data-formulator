import { useMemo } from 'react';
import {
  Box,
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

// Each area's share of the year's papers as a stream; `focus` (areas) keeps those in colour.
function Streams({ rows, focus }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const height = 330;
  const areas = useMemo(
    () => d3.groupSort(rows, items => -d3.sum(items, row => row.papers), row => row.area),
    [rows],
  );
  const years = useMemo(() => [...new Set(rows.map(row => row.year))].sort((a, b) => a - b), [rows]);
  const series = useMemo(() => {
    const table = years.map(year => Object.fromEntries([['year', year], ...areas.map(area => [area,
      rows.find(row => row.year === year && row.area === area)?.share || 0])]));
    return d3.stack().keys(areas).offset(d3.stackOffsetExpand).order(d3.stackOrderNone)(table);
  }, [rows, areas, years]);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([0, Math.max(1, width - 150)]);
  const y = d3.scaleLinear().domain([0, 1]).range([height - 20, 0]);
  const area = d3.area().curve(d3.curveBasis).x(point => x(point.data.year)).y0(point => y(point[0]))
    .y1(point => y(point[1]));
  const end = years[years.length - 1];
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} fontSize={11} role="img" aria-label="Topic areas by year">
          {series.map((layer, index) => {
            const on = !focus || focus.includes(layer.key);
            const last = layer[layer.length - 1];
            const mid = (y(last[0]) + y(last[1])) / 2;
            return (
              <Tooltip key={layer.key} title={layer.key}>
                <g>
                  <path d={area(layer)} fill={inks.palette[index % inks.palette.length]}
                    fillOpacity={on ? 0.9 : 0.12} style={{ transition: 'fill-opacity 500ms' }} />
                  {(on || !focus) && y(last[0]) - y(last[1]) > 11 && (
                    <text x={x(end) + 6} y={mid} dy="0.35em" fill={inks.text} fontWeight={on && focus ? 600 : 400}>
                      {layer.key}
                    </text>
                  )}
                </g>
              </Tooltip>
            );
          })}
          {[1990, 2000, 2010, 2020].map(year => (
            <text key={year} x={x(year)} y={height - 4} textAnchor="middle" fill={inks.muted}>{year}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

// A tile per word: the word, its share of titles over the years as a small area, its peak and today.
function WordTiles({ rows, focus }) {
  const inks = useInks();
  const terms = d3.groupSort(rows, items => d3.maxIndex(items, row => row.share), row => row.term);
  return (
    <Grid container spacing={1.5}>
      {terms.map(term => {
        const own = rows.filter(row => row.term === term).sort((a, b) => a.year - b.year);
        const peak = own[d3.maxIndex(own, row => row.share)];
        const now = own[own.length - 1];
        const on = !focus || focus === term;
        return (
          <Grid key={term} size={{ xs: 6, sm: 4 }}>
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
              opacity: on ? 1 : 0.35, transition: 'opacity 500ms' }}>
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2 }}>{`“${term}”`}</Typography>
              <Spark rows={own} colour={on && focus ? inks.accent : inks.palette[1]} />
              <Typography variant="caption" color="text.secondary" component="div">
                {`Peak ${format.number(peak.share, 0)}% of titles in ${peak.year}`}
              </Typography>
              <Typography variant="caption" component="div" fontWeight={600}>
                {`${now.year}: ${format.number(now.share, 1)}%`}
              </Typography>
            </Box>
          </Grid>
        );
      })}
    </Grid>
  );
}

function Spark({ rows, colour }) {
  const [ref, { width }] = useMeasure();
  const height = 44;
  const x = d3.scaleLinear().domain(d3.extent(rows, row => row.year)).range([0, Math.max(1, width)]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, row => row.share) || 1]).range([height, 2]);
  const shape = d3.area().curve(d3.curveMonotoneX).x(row => x(row.year)).y0(height).y1(row => y(row.share));
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Share of titles by year">
          <path d={shape(rows)} fill={colour} fillOpacity={0.85} />
        </svg>
      )}
    </div>
  );
}

export default function App() {
  const topics = useQuery('topic_areas_by_year', { orderBy: ['year', 'area'] });
  const words = useQuery('title_words_by_year', { orderBy: ['term', 'year'] });
  const rows = topics.rows;
  const share = (area, from, to) => {
    const own = rows.filter(row => row.year >= from && row.year <= to);
    return 100 * d3.sum(own.filter(row => row.area === area), row => row.papers) / (d3.sum(own, row => row.papers) || 1);
  };
  const last = d3.max(rows, row => row.year) || 2026;
  const word = (term, year) => words.rows.find(row => row.term === term && row.year === year)?.share || 0;
  const peak = term => {
    const own = words.rows.filter(row => row.term === term);
    return own[d3.maxIndex(own, row => row.share)]?.year;
  };
  const steps = [
    {
      title: 'It started with neural networks',
      text: `In NeurIPS's first five years, ${format.number(share('Deep Learning', 1987, 1991), 0)}% of papers were `
        + 'about neural networks (deep learning, in today\'s terms) and '
        + `${format.number(share('Applications', 1987, 1991), 0)}% about applications such as the brain and speech. `
        + 'Each stream is one area\'s share of the year\'s papers.',
      focus: ['Deep Learning', 'Applications'],
    },
    {
      title: 'Then probability and theory',
      text: `By 2000–2010, neural networks had nearly vanished (${format.number(share('Deep Learning', 2000, 2010), 0)}% `
        + `of papers). Probabilistic methods (${format.number(share('Probabilistic Methods', 2000, 2010), 0)}%) and `
        + `theory (${format.number(share('Theory', 2000, 2010), 0)}%) took their place: kernels, graphical models, bounds.`,
      focus: ['Probabilistic Methods', 'Theory'],
    },
    {
      title: 'Deep learning returns, and vision rises',
      text: `Since 2012, deep learning is back (${format.number(share('Deep Learning', last - 4, last), 0)}% of papers `
        + `in ${last - 4}–${last}) and computer vision grew to ${format.number(share('Computer Vision', last - 4, last), 0)}%; `
        + `fairness and safety (social aspects) went from almost none to ${format.number(share('Social Aspects', last - 4, last), 0)}%.`,
      focus: ['Deep Learning', 'Computer Vision', 'Social Aspects'],
    },
  ];

  return (
    <AppTheme theme="neurips-df" density="normal">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={5}>
          <AppHeader
            variant="editorial"
            kicker="NeurIPS over the years"
            title="Neural networks, then probability, then deep learning: forty years of ideas"
            deck={'Every NeurIPS paper since 1987, classified by an AI model into today\'s topic areas, '
              + 'and the words in their titles.'}
            source="__SOURCE__"
          />
          {steps.map(item => (
            <Step key={item.title} title={item.title} text={item.text}>
              <Streams rows={rows} focus={item.focus} />
            </Step>
          ))}
          <Step
            title="The words tell it too"
            text={`“Neural network” was in ${format.number(word('neural network', 1987), 0)}% of titles in 1987; `
              + `“kernel” peaked in ${peak('kernel')}, “Bayesian” in ${peak('Bayesian')} and “deep” in ${peak('deep')}.`}
          >
            <WordTiles rows={words.rows} />
          </Step>
          <Step
            title="Now: language models"
            text={`In ${last}, ${format.number(word('language model', last), 0)}% of NeurIPS titles name language `
              + `models, and ${format.number(word('diffusion', last), 0)}% diffusion. Topics here are an AI model's `
              + 'reading of each paper, so read them as broad trends.'}
          >
            <WordTiles rows={words.rows} focus="language model" />
          </Step>
        </Stack>
      </Container>
    </AppTheme>
  );
}
