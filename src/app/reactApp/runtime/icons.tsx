// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `@df/icons`: a curated icon set by name (the full MUI icon set is too large to ship). */

import React from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Add from '@mui/icons-material/Add';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import ArrowForward from '@mui/icons-material/ArrowForward';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import AttachMoney from '@mui/icons-material/AttachMoney';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import BarChart from '@mui/icons-material/BarChart';
import Bolt from '@mui/icons-material/Bolt';
import CalendarMonth from '@mui/icons-material/CalendarMonth';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import Close from '@mui/icons-material/Close';
import DirectionsCar from '@mui/icons-material/DirectionsCar';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import FavoriteBorder from '@mui/icons-material/FavoriteBorder';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FilterList from '@mui/icons-material/FilterList';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import Flight from '@mui/icons-material/Flight';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import LocalHospitalOutlined from '@mui/icons-material/LocalHospitalOutlined';
import People from '@mui/icons-material/People';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import Public from '@mui/icons-material/Public';
import Refresh from '@mui/icons-material/Refresh';
import Remove from '@mui/icons-material/Remove';
import Schedule from '@mui/icons-material/Schedule';
import School from '@mui/icons-material/School';
import Search from '@mui/icons-material/Search';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import ShowChart from '@mui/icons-material/ShowChart';
import StarOutline from '@mui/icons-material/StarOutline';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import TrendingDown from '@mui/icons-material/TrendingDown';
import TrendingFlat from '@mui/icons-material/TrendingFlat';
import TrendingUp from '@mui/icons-material/TrendingUp';
import WarningAmber from '@mui/icons-material/WarningAmber';
import WorkOutline from '@mui/icons-material/WorkOutline';

export const ICONS = {
    'add': Add, 'arrow-down': ArrowDownward, 'arrow-right': ArrowForward, 'arrow-up': ArrowUpward,
    'calendar': CalendarMonth, 'car': DirectionsCar, 'cart': ShoppingCartOutlined, 'chart': BarChart,
    'check': CheckCircleOutline, 'close': Close, 'download': FileDownloadOutlined, 'energy': Bolt,
    'error': ErrorOutline, 'filter': FilterList, 'flag': FlagOutlined, 'flight': Flight, 'globe': Public,
    'health': LocalHospitalOutlined, 'heart': FavoriteBorder, 'home': HomeOutlined, 'idea': LightbulbOutlined,
    'info': InfoOutlined, 'line-chart': ShowChart, 'location': PlaceOutlined, 'money': AttachMoney,
    'people': People, 'refresh': Refresh, 'remove': Remove, 'school': School, 'search': Search,
    'sparkle': AutoAwesome, 'star': StarOutline, 'table': TableChartOutlined, 'time': Schedule,
    'trend-down': TrendingDown, 'trend-flat': TrendingFlat, 'trend-up': TrendingUp, 'warning': WarningAmber,
    'work': WorkOutline,
} as const;

export type IconName = keyof typeof ICONS;
export const iconNames = Object.keys(ICONS) as IconName[];

/** An icon by name, e.g. <Icon name="trend-up" />. Unknown names render nothing. */
export function Icon({ name, ...props }: { name: IconName } & SvgIconProps) {
    const Component = ICONS[name];
    if (!Component) return null;
    return <Component fontSize="small" {...props} />;
}
