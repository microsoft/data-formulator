// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** The `lodash` app module: `import _ from 'lodash'` or `import { groupBy } from 'lodash'`. */

import lodash from 'lodash';

import { registerOptionalModule } from './register';

registerOptionalModule('lodash', lodash);
