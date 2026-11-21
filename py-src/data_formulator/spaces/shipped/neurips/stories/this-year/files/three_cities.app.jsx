// @df-app {"version": 2, "title": "NeurIPS 2026 in three cities", "tables": ["city_countries_2026", "poster_sessions_2026"]}
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
import { countries } from '@df/geo';
import { useQuery } from '@df/data';
import {
  AppHeader,
  AppTheme,
  useInks,
  useMeasure,
} from '@df/chart';
import { format } from '@df/format';

// Where the three cities are, for their markers.
const PLACES = {
  Sydney: [151.21, -33.87],
  Atlanta: [-84.39, 33.75],
  Paris: [2.35, 48.86],
};
const CITIES = Object.keys(PLACES);
// Countries with no papers in view, and the map's land.
const NO_DATA = '#e7eaf0';

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

// The world, each country shaded by the share of one city's papers with an author there,
// and the three cities as circles sized by their papers.
function CityMap({ rows, totals, city }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const height = Math.round(width * 0.5);
  // Antarctica (010) left out: no authors there, and it takes a third of the map.
  const shapes = useMemo(() => countries().filter(shape => Number(shape.id) !== 10), []);
  const projection = useMemo(
    () => d3.geoNaturalEarth1().fitSize([width, height], { type: 'FeatureCollection', features: shapes }),
    [width, height],
  );
  const path = d3.geoPath(projection);
  const share = new Map(rows.filter(row => row.city === city).map(row => [row.map_id, row.share]));
  const colour = inks.palette[CITIES.indexOf(city)] || inks.accent;
  const shade = d3.scaleSqrt().domain([0, 60]).range([0.08, 1]).clamp(true);
  const radius = d3.scaleSqrt().domain([0, d3.max(Object.values(totals)) || 1]).range([0, width / 22]);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="World map of the three cities">
          {shapes.map(shape => {
            const value = share.get(Number(shape.id));
            const name = shape.properties.name;
            return (
              <Tooltip key={shape.id} title={value ? `${name}: ${format.number(value, 0)}%` : name}>
                <path
                  d={path(shape)}
                  fill={value ? colour : NO_DATA}
                  fillOpacity={value ? shade(value) : 1}
                  stroke="#fff"
                  strokeWidth={0.5}
                  style={{ transition: 'fill 600ms, fill-opacity 600ms' }}
                />
              </Tooltip>
            );
          })}
          {CITIES.map((name, index) => {
            const [x, y] = projection(PLACES[name]);
            const picked = !city || city === name;
            return (
              <g key={name} opacity={picked ? 1 : 0.35} style={{ transition: 'opacity 600ms' }}>
                <circle
                  cx={x}
                  cy={y}
                  r={radius(totals[name] || 0)}
                  fill={inks.palette[index]}
                  fillOpacity={city ? 0.25 : 0.8}
                  stroke={inks.palette[index]}
                  strokeWidth={2}
                />
                <text x={x} y={y - radius(totals[name] || 0) - 6} textAnchor="middle"
                  fontSize={13} fontWeight={600} fill={inks.text}>
                  {`${name} · ${format.number(totals[name] || 0, 0)}`}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// Every poster session: a row per day and city, a block per session from its start to its end.
function Timetable({ sessions }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const days = [...new Set(sessions.map(row => String(row.day).slice(0, 10)))].sort();
  const lane = 30;
  const left = 150;
  const hour = value => Number(value.slice(0, 2)) + Number(value.slice(3, 5)) / 60;
  const from = Math.floor(d3.min(sessions, row => hour(row.starts)) || 9);
  const to = Math.ceil(d3.max(sessions, row => hour(row.ends)) || 19);
  const x = d3.scaleLinear().domain([from, to]).range([left, Math.max(left + 1, width - 8)]);
  const lanes = days.flatMap(day => CITIES
    .filter(city => sessions.some(row => String(row.day).startsWith(day) && row.city === city))
    .map(city => ({ day, city })));
  const height = lanes.length * lane + 24;
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} fontSize={12} role="img" aria-label="Poster sessions by day">
          {d3.range(from, to + 1).map(tick => (
            <g key={tick} transform={`translate(${x(tick)},0)`}>
              <line y2={height - 20} stroke={inks.grid} />
              <text y={height - 6} textAnchor="middle" fill={inks.muted} fontSize={11}>{`${tick}:00`}</text>
            </g>
          ))}
          {lanes.map((item, index) => {
            const y = index * lane;
            const label = d3.timeFormat('%a %-d %b')(new Date(`${item.day}T12:00:00`));
            return (
              <g key={`${item.day}-${item.city}`}>
                <text x={left - 10} y={y + lane / 2} dy="0.35em" textAnchor="end" fill={inks.text}>
                  {`${label} · ${item.city}`}
                </text>
                {sessions
                  .filter(row => String(row.day).startsWith(item.day) && row.city === item.city)
                  .map(row => (
                    <Tooltip
                      key={row.session}
                      title={`${row.session}, ${row.starts}–${row.ends}: ${format.number(row.papers, 0)} posters, `
                        + `most on ${row.main_area}`}
                    >
                      <g>
                        <rect
                          x={x(hour(row.starts))}
                          y={y + 3}
                          width={Math.max(2, x(hour(row.ends)) - x(hour(row.starts)))}
                          height={lane - 6}
                          rx={5}
                          fill={inks.palette[CITIES.indexOf(row.city)]}
                          fillOpacity={0.85}
                        />
                        <text x={x(hour(row.starts)) + 8} y={y + lane / 2} dy="0.35em" fill="#fff" fontWeight={600}>
                          {`${format.number(row.papers, 0)} posters`}
                        </text>
                      </g>
                    </Tooltip>
                  ))}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// The countries with the largest share of a city's papers, as words.
const leaders = (rows, city, count = 3) => rows
  .filter(row => row.city === city)
  .sort((a, b) => b.share - a.share)
  .slice(0, count)
  .map(row => `${row.country} (${format.number(row.share, 0)}%)`)
  .join(', ');

export default function App() {
  const places = useQuery('city_countries_2026', { orderBy: ['city', 'country'] });
  const sessions = useQuery('poster_sessions_2026', { orderBy: ['day', 'starts', 'city'] });
  const rows = places.rows;
  const totals = d3.rollup(sessions.rows, items => d3.sum(items, row => row.papers), row => row.city);
  const counts = Object.fromEntries(CITIES.map(city => [city, totals.get(city) || 0]));
  const all = d3.sum(CITIES, city => counts[city]) || 1;
  const steps = [
    {
      title: 'One conference, three cities',
      text: `NeurIPS 2026 is held in three cities at once. Sydney shows ${format.number(counts.Sydney, 0)} `
        + `of its posters, ${format.number(100 * counts.Sydney / all, 0)}% of them; Atlanta shows `
        + `${format.number(counts.Atlanta, 0)} and Paris ${format.number(counts.Paris, 0)}. `
        + 'Each circle is sized by its posters.',
      city: null,
    },
    ...CITIES.map(city => ({
      title: `Who presents in ${city}`,
      text: `Shaded by the share of ${city}'s papers with at least one author working in each country. `
        + `The most: ${leaders(rows, city)}.`,
      city,
    })),
  ];

  return (
    <AppTheme theme="neurips-df" density="normal">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={5}>
          <AppHeader
            variant="editorial"
            kicker="NeurIPS 2026"
            title={`Sydney shows ${format.number(100 * counts.Sydney / all, 0)}% of NeurIPS 2026's posters`}
            deck={'For the first time, NeurIPS meets in three cities. Here is who presents where, '
              + 'and when every poster session is.'}
            source="neurips.cc, NeurIPS 2026 schedule (November 2026); ROR; OpenAlex"
          />
          {steps.map(item => (
            <Step key={item.title} title={item.title} text={item.text}>
              <CityMap rows={rows} totals={counts} city={item.city} />
            </Step>
          ))}
          <Stack spacing={1.5}>
            <Typography variant="h5" component="h2">Plan a visit</Typography>
            <Typography sx={{ fontSize: '1.0625rem', lineHeight: 1.65, maxWidth: 760 }}>
              Every poster session, in each city's own time. Hover a session for its posters and the topic
              most of them are on.
            </Typography>
            <Box>
              <Timetable sessions={sessions.rows} />
            </Box>
          </Stack>
        </Stack>
      </Container>
    </AppTheme>
  );
}
