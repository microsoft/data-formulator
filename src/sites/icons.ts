// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';

/** Icons a demo's dataset can name (`icon` in the profile); any other name gets the table. */
const STARTER_ICONS: Record<string, typeof TableChartOutlinedIcon> = {
    school: SchoolOutlinedIcon, science: ScienceOutlinedIcon, landmark: AccountBalanceOutlinedIcon,
    chart: InsertChartOutlinedIcon, table: TableChartOutlinedIcon,
};

export const starterIcon = (icon?: string) => (icon && STARTER_ICONS[icon]) || TableChartOutlinedIcon;
