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

// A country's latest and first year with a value of a field.
const ends = (rows, country, field) => {
  const kept = rows.filter(row => row.country === country && row[field] !== null);
  return [kept[0], kept[kept.length - 1]];
};
const inYear = (rows, country, year) => rows.find(row => row.country === country && row.year === year);

export default function App() {
  const series = useQuery('china_us_research', { orderBy: ['country', 'year'] });
  const rows = series.rows;
  const [chinaFirst, chinaLast] = ends(rows, 'China', 'rd_share');
  const [usFirst] = ends(rows, 'US', 'rd_share');
  const usSameYear = inYear(rows, 'US', chinaLast?.year);
  const ratioNow = chinaLast && usSameYear?.rd_share ? chinaLast.rd_share / usSameYear.rd_share : null;
  const ratioThen = chinaFirst && usFirst ? chinaFirst.rd_share / usFirst.rd_share : null;
  const [, chinaPeople] = ends(rows, 'China', 'researchers_per_million');
  const [, usPeople] = ends(rows, 'US', 'researchers_per_million');

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Research"
            title={ratioNow
              ? `China spends ${format.number(chinaLast.rd_share, 2)}% of GDP on research, `
                + `${format.percent(ratioNow, 0)} of the US level`
              : 'China and the US in research'}
            deck="Research spending as a share of GDP, and researchers per million people, China and the US."
            period={[rows[0]?.year, chinaLast?.year]}
            source="__SOURCE__"
          />
          <KpiStrip>
            <Kpi
              label={`China, research spending, ${chinaLast?.year ?? ''}`}
              value={chinaLast?.rd_share}
              format="number:2"
              unit="% of GDP"
              previous={chinaFirst?.rd_share}
              vs={String(chinaFirst?.year ?? '')}
              change="number"
            />
            <Kpi
              label={`US, research spending, ${usSameYear?.year ?? ''}`}
              value={usSameYear?.rd_share}
              format="number:2"
              unit="% of GDP"
              previous={usFirst?.rd_share}
              vs={String(usFirst?.year ?? '')}
              change="number"
            />
            <Kpi
              label="China’s spending share against the US"
              value={ratioNow}
              format="percent"
              previous={ratioThen}
              vs={String(chinaFirst?.year ?? '')}
            />
          </KpiStrip>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Tile
                title="China’s spending share has closed in on the US"
                subtitle="Research spending, % of GDP"
                height={380}
              >
                <FlintChart
                  chartType="Line Chart"
                  table="china_us_research"
                  query={series}
                  height="fill"
                  encodings={{ x: 'year', y: 'rd_share', color: 'country' }}
                  labels={{ year: '', rd_share: '', country: '' }}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Tile
                title={chinaPeople && usPeople
                  ? `The US still has ${format.number(usPeople.researchers_per_million / chinaPeople.researchers_per_million, 1)}`
                    + ' times as many researchers per person'
                  : 'Researchers per million people'}
                subtitle="Researchers per million people (full-time equivalent)"
                height={380}
              >
                <FlintChart
                  chartType="Line Chart"
                  table="china_us_research"
                  query={series}
                  height="fill"
                  encodings={{ x: 'year', y: 'researchers_per_million', color: 'country' }}
                  labels={{ year: '', researchers_per_million: '', country: '' }}
                />
              </Tile>
            </Grid>
          </Grid>
        </Stack>
      </Container>
    </AppTheme>
  );
}
