const path = require('path');

module.exports = {
    mode: 'development', // for debuggable build
    entry: './src/index.tsx',
    output: {
        publicPath: '',
        path: path.resolve(__dirname, 'build/static/js'),
        filename: 'embedDataFormulator.js',
        library: 'embedDataFormulator',
        libraryTarget: 'umd',
        globalObject: 'this',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.(css|scss)$/,
                use: [
                    'style-loader', // Creates `style` nodes from JS strings.
                    'css-loader',   // Translates CSS into CommonJS.
                    'sass-loader'   // Compiles Sass to CSS.
                ],
            },
            {
                test: /\.(woff|woff2|png|svg|jpg|jpeg|gif)$/i,
                type: 'asset/inline',
            },
        ],
    },
    optimization: {
        runtimeChunk: false,
        splitChunks: {
            cacheGroups: {
                default: false,
            },
        },
        concatenateModules: true, //forces Webpack to combine all modules into one closure
        minimize: false,
    },
};
