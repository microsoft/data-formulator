// @df-app {"version": 2, "title": "The largest hosts of students from abroad", "tables": ["international_students_hosted", "international_students_trend"]}
import {
  Container,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@df/data';
import {
  AppHeader,
  AppTheme,
  BarList,
  FlintChart,
  Kpi,
  KpiStrip,
} from '@df/chart';
import { format } from '@df/format';

function Tile({ title, subtitle, caption, height = '100%', children }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, height, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Stack spacing={0.25}>
        <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        )}
      </Stack>
      {children}
      {caption && (
        <Typography variant="caption" color="text.secondary">{caption}</Typography>
      )}
    </Paper>
  );
}

// Country names that read with "the" in a sentence.
const WITH_THE = new Set(['US', 'UK', 'Netherlands', 'United Arab Emirates', 'Philippines', 'Czech Republic']);
const named = (country, start) => (WITH_THE.has(country) ? `${start ? 'The' : 'the'} ${country}` : country);

// Each host's first and latest year in the trend, and how much it grew between them.
const growth = (rows, country) => {
  const kept = rows.filter(row => row.country === country);
  const first = kept[0];
  const last = kept[kept.length - 1];
  return first && last ? { country, first, last, ratio: last.international_students / first.international_students - 1 } : null;
};

export default function App() {
  const hosts = useQuery('international_students_hosted', { orderBy: 'international_students', descending: true, limit: 10 });
  const all = useQuery('international_students_hosted', { limit: 500 });
  const trend = useQuery('international_students_trend', { orderBy: ['country', 'year'], limit: 500 });
  const [first, second] = hosts.rows;
  const grown = [...new Set(trend.rows.map(row => row.country))].map(country => growth(trend.rows, country)).filter(Boolean);
  const fastest = grown.reduce((best, item) => (!best || item.ratio > best.ratio ? item : best), null);
  const large = all.rows.filter(row => row.international_students >= 100000).length;
  const series = country => trend.rows.filter(row => row.country === country);

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Students abroad"
            title={first && second
              ? `${named(first.country, true)} and ${named(second.country)} host the most students from abroad`
              : 'Where students from abroad study'}
            deck="International students in higher education, by host country: the largest hosts and how they grew since 2010."
            source="UIS, November 2026 release; indicator 26637"
          />
          <KpiStrip>
            <Kpi
              label={first ? `${first.country}, ${first.latest_year}` : '—'}
              value={first?.international_students}
              format="compact"
              trend={first ? series(first.country) : []}
              x="year"
              y="international_students"
            />
            <Kpi
              label={second ? `${second.country}, ${second.latest_year}` : '—'}
              value={second?.international_students}
              format="compact"
              trend={second ? series(second.country) : []}
              x="year"
              y="international_students"
            />
            <Kpi
              label="Countries hosting 100,000 or more"
              value={large}
              format="number"
              note={`of ${all.rows.length} reporting`}
            />
          </KpiStrip>
          <Grid container spacing={2} alignItems="flex-start">
            <Grid size={{ xs: 12, md: 7 }}>
              <Tile
                title={fastest
                  ? `${fastest.country} grew fastest: ${format.percent(fastest.ratio, 0)} more since ${fastest.first.year}`
                  : 'The largest hosts over time'}
                subtitle="International students hosted, the five largest hosts"
                height={420}
              >
                <FlintChart
                  chartType="Line Chart"
                  table="international_students_trend"
                  query={trend}
                  height="fill"
                  encodings={{ x: 'year', y: 'international_students', color: 'country' }}
                  labels={{ year: '', international_students: '', country: '' }}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Tile title="The largest hosts" subtitle="International students, latest year">
                <BarList query={hosts} label="country" value="international_students" format="compact" limit={10} />
              </Tile>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            Students who crossed a border to study in higher education; each country's latest report.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
