// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';

import {
    Box,
    Button,
    Typography,
} from '@mui/material';

import embed from 'vega-embed';

import '../scss/VisualizationView.scss';

export interface TestPanelProps {
}

export interface TestPanelState {
    vgSpecs: any[]
}

export default class TestPanel extends React.Component<TestPanelProps, TestPanelState> {

    constructor(props: TestPanelProps) {
        super(props);
        this.state = {
            vgSpecs: []
        };
    }

    private processText(reader: any, state: any) : any {
        // Result objects contain two properties:
        // done  - true if the stream has already given you all its data.
        // value - some data. Always undefined when done is true.

        let { done, value } = state;

        if (done) {
            console.log("Stream complete");
            return;
        }
    
        // value for fetch streams is a Uint8Array
        const chunk = value;
        console.log(`Current chunk = ${chunk}`);

        if (value) {
            let vgObj = JSON.parse(value);
            let vgSpecs = this.state.vgSpecs;
            vgSpecs.push(vgObj);
            this.setState({
                vgSpecs
            });
        }
    
        // Read some more, and call this function again
        return reader.read().then((state: any) => this.processText(reader, state));
    }

    private testStreamingChart = () => {
        fetch('http://127.0.0.1:5000/stream')
            // Retrieve its body as ReadableStream
            .then((response) => response.body)
            // Create a gray-scaled PNG stream out of the original
            .then((body) => (body as ReadableStream).pipeThrough(new TextDecoderStream()).getReader())
            .then((reader) => {
                reader.read().then((state: any) => this.processText(reader, state))
            })
    }

    public render = () => {
        return (
            <Box className="visualization-container">
                <Typography variant="subtitle1" component="h2">
                    TestPanel
                </Typography>
                <Button variant="contained" onClick={()=>{this.testStreamingChart()}}>Contained</Button>
                <Box className="vega-container">
                    {this.state.vgSpecs.map((spec: any, index: any) => {
                        const id = `chart-element-${index}`;
                        const element = <div id={id} key={`chart-${index}`}></div>;
                        embed('#' + id, spec);
                        return element;
                    })}
                </Box>
            </Box>);
    };
}