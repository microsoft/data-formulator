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

export default function App() {
  const trend = useQuery('adult_illiteracy_by_sex', { orderBy: ['year', 'sex'] });
  const regions = useQuery('adult_illiteracy_by_region', { orderBy: 'millions', descending: true });

  // World totals per year, from the women and men who cannot read.
  const totals = Object.values(trend.rows.reduce((sums, row) => {
    const sum = (sums[row.year]?.millions ?? 0) + row.millions;
    sums[row.year] = { year: row.year, millions: sum };
    return sums;
  }, {}));
  const first = totals[0];
  const latest = totals[totals.length - 1];
  const women = trend.rows.find(row => row.year === latest?.year && row.sex === 'Women');
  const womenShare = women && latest ? women.millions / latest.millions : null;
  const top = regions.rows[0];
  const topShare = top && latest ? top.millions / latest.millions : null;
  const millions = value => `${format.number(value, 0)} million`;

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Adult literacy"
            title={latest ? `${millions(latest.millions)} adults still cannot read` : 'Adults who cannot read'}
            deck="Adults aged 15 and over who cannot read and write a simple statement, world and regions."
            period={[first?.year, latest?.year]}
            source="__SOURCE__"
          />
          <KpiStrip>
            <Kpi
              label={`Adults who cannot read, ${latest?.year ?? ''}`}
              value={latest?.millions}
              format="number"
              unit="million"
              previous={first?.millions}
              vs={String(first?.year ?? '')}
              good="down"
              trend={totals}
              x="year"
              y="millions"
            />
            <Kpi
              label="Women among them"
              value={womenShare}
              format="percent"
              note={women ? millions(women.millions) : null}
            />
            <Kpi
              label={`Most in ${top?.region ?? '—'}`}
              value={topShare}
              format="percent"
              note={top ? `${millions(top.millions)} of the world's total` : null}
            />
          </KpiStrip>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 8 }}>
              <Tile
                title={first && latest
                  ? `Down from ${millions(first.millions)} in ${first.year}, but women stay the majority`
                  : 'Adults who cannot read'}
                subtitle="Adults aged 15 and over who cannot read, world, by sex, millions"
                height={380}
              >
                <FlintChart
                  chartType="Area Chart"
                  table="adult_illiteracy_by_sex"
                  query={trend}
                  height="fill"
                  encodings={{ x: 'year', y: 'millions', color: 'sex' }}
                  labels={{ year: '', millions: '', sex: '' }}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Tile
                title={top ? `${top.region} has the most` : 'By region'}
                subtitle={`Adults who cannot read, millions, ${top?.year ?? ''}`}
              >
                <BarList
                  query={regions}
                  label="region"
                  value="millions"
                  format="number:1"
                />
              </Tile>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            UIS estimates for adults aged 15 and over; SDG regions with an estimate for the latest year.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
