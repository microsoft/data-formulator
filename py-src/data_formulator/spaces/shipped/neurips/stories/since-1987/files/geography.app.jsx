// @df-app {"version": 2, "title": "Where NeurIPS authors work", "tables": ["country_shares_by_year", "country_shares_then_now"]}
import { useMemo } from 'react';
import {
  Container,
  Grid,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import * as d3 from 'd3';
import { countries } from '@df/geo';
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

// The world shaded by the share of papers with an author in each country, in one period (`then` or
// `now`), on one scale for both so the change shows.
function ShareMap({ rows, period }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const height = Math.round(width * 0.5);
  // Antarctica (010) left out: no authors there, and it takes a third of the map.
  const shapes = useMemo(() => countries().filter(shape => Number(shape.id) !== 10), []);
  const projection = useMemo(
    () => d3.geoNaturalEarth1().fitSize([width, height - 24], { type: 'FeatureCollection', features: shapes }),
    [width, height],
  );
  const path = d3.geoPath(projection);
  const field = period === 'then' ? 'share_then' : 'share_now';
  const values = new Map(rows.map(row => [row.map_id, row[field]]));
  const colour = d3.scaleSequentialSqrt(d3.interpolateRgb('#dfe7fd', inks.accent)).domain([0, 60]).clamp(true);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Share of papers by country">
          {shapes.map(shape => {
            const value = values.get(Number(shape.id));
            return (
              <Tooltip key={shape.id}
                title={`${shape.properties.name}: ${value ? `${format.number(value, 1)}% of papers` : 'none'}`}>
                <path d={path(shape)} fill={value ? colour(value) : '#eef0f4'} stroke="#fff"
                  strokeWidth={0.5} style={{ transition: 'fill 700ms' }} />
              </Tooltip>
            );
          })}
          {[1, 10, 30, 60].map((tick, index) => (
            <g key={tick} transform={`translate(${12 + index * 58},${height - 14})`}>
              <rect width={18} height={10} rx={2} fill={colour(tick)} />
              <text x={22} y={9} fontSize={11} fill={inks.muted}>{`${tick}%`}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function App() {
  const lines = useQuery('country_shares_by_year', { orderBy: ['year', 'place'] });
  const maps = useQuery('country_shares_then_now', { orderBy: 'country' });
  const at = (place, year) => lines.rows.find(row => row.place === place && row.year === year)?.share || 0;
  const last = d3.max(lines.rows, row => row.year) || 2026;
  const top = period => [...maps.rows].sort((a, b) => b[period] - a[period]).slice(0, 3)
    .map(row => `${row.country} (${format.number(row[period], 0)}%)`).join(', ');
  const usPeak = lines.rows.filter(row => row.place === 'US')
    .reduce((best, row) => (!best || row.share > best.share ? row : best), null);
  const chart = (focus, note) => (
    <FlintChart
      chartType="Line Chart"
      query={lines}
      height={320}
      encodings={{ x: 'year', y: 'share', color: 'place' }}
      semanticTypes={{ year: 'Year' }}
      labels={{ year: '', share: '% of papers', place: '' }}
      focus={focus}
      note={note}
    />
  );

  return (
    <AppTheme theme="neurips-df" density="normal">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={5}>
          <AppHeader
            variant="editorial"
            kicker="NeurIPS over the years"
            title={`China's share of NeurIPS papers rose from ${format.number(at('China', 2010), 0)}% to `
              + `${format.number(at('China', last), 0)}%`}
            deck="Where the authors of NeurIPS papers work, since 2000: the share of papers with an author in each place."
            source="NeurIPS proceedings and neurips.cc; affiliations from neurips.cc (2020 on) and OpenAlex; ROR"
          />
          <Step
            title="For years, a US conference"
            text={`In 2010, ${format.number(at('US', 2010), 0)}% of NeurIPS papers had an author working in the US, `
              + `and ${format.number(at('Europe', 2010), 0)}% one in Europe; the US share peaked at `
              + `${format.number(usPeak?.share || 0, 0)}% in ${usPeak?.year}.`}
          >
            {chart({ place: 'US', year: usPeak?.year }, `${format.number(usPeak?.share || 0, 0)}%`)}
          </Step>
          <Step
            title="Then China rose"
            text={`China went from ${format.number(at('China', 2010), 0)}% of papers in 2010 to `
              + `${format.number(at('China', last), 0)}% in ${last}, while the US share fell to `
              + `${format.number(at('US', last), 0)}%. A paper counts for each place one of its authors works.`}
          >
            {chart({ place: 'China', year: last }, `${format.number(at('China', last), 0)}%`)}
          </Step>
          <Step
            title="The map, 2008–2012"
            text={`Each country shaded by the share of papers with an author working there. Then: ${top('share_then')}.`}
          >
            <ShareMap rows={maps.rows} period="then" />
          </Step>
          <Step
            title={`The map, ${last}`}
            text={`Now: ${top('share_now')}. Affiliations before 2020 are known only for the papers OpenAlex `
              + 'records, so the earlier map is an estimate.'}
          >
            <ShareMap rows={maps.rows} period="now" />
          </Step>
        </Stack>
      </Container>
    </AppTheme>
  );
}
