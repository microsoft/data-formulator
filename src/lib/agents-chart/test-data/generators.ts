// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Synthetic data generators for chart gallery test cases.
 * Pure utility functions — no React/UI dependencies.
 */

// ============================================================================
// Synthetic Data Generators
// ============================================================================

/** Seeded random for reproducibility */
export function seededRandom(seed: number) {
    return () => {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

/** Generate an array of sequential dates */
export function genDates(n: number, startYear = 2018): string[] {
    const dates: string[] = [];
    const start = new Date(startYear, 0, 1);
    for (let i = 0; i < n; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + Math.floor(i * (365 * 3 / n)));
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

/** Generate month names */
export function genMonths(n: number): string[] {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months.slice(0, Math.min(n, 12));
}

/** Generate year values */
export function genYears(n: number, start = 2000): number[] {
    return Array.from({ length: n }, (_, i) => start + i);
}

/** Generate natural-looking date strings like "Jun 12 1998" */
export function genNaturalDates(n: number, startYear = 1998): string[] {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dates: string[] = [];
    const start = new Date(startYear, 0, 1);
    for (let i = 0; i < n; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + Math.floor(i * (365 * 5 / n)));
        dates.push(`${monthNames[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`);
    }
    return dates;
}

/** Generate category names by semantic type */
export function genCategories(semanticType: string, n: number): string[] {
    const pools: Record<string, string[]> = {
        Country: ['USA', 'China', 'Japan', 'Germany', 'UK', 'France', 'India', 'Brazil', 'Canada', 'Australia',
            'South Korea', 'Mexico', 'Italy', 'Spain', 'Russia', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Finland',
            'Switzerland', 'Belgium', 'Austria', 'Poland', 'Portugal', 'Turkey', 'Argentina', 'Chile', 'Colombia', 'Peru'],
        Company: ['Apple', 'Google', 'Microsoft', 'Amazon', 'Meta', 'Tesla', 'Netflix', 'Adobe', 'Intel', 'Nvidia',
            'Samsung', 'IBM', 'Oracle', 'SAP', 'Salesforce', 'Uber', 'Lyft', 'Spotify', 'Snap', 'Twitter',
            'Palantir', 'Shopify', 'Square', 'Zoom', 'Slack', 'Twilio', 'Datadog', 'Snowflake', 'Confluent', 'MongoDB'],
        Product: ['Laptop', 'Phone', 'Tablet', 'Desktop', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Speaker', 'Camera',
            'TV', 'Router', 'Printer', 'Scanner', 'SSD', 'HDD', 'RAM', 'GPU', 'CPU', 'Motherboard'],
        Category: ['Electronics', 'Clothing', 'Food', 'Books', 'Sports', 'Home', 'Garden', 'Auto', 'Health', 'Beauty',
            'Toys', 'Music', 'Movies', 'Software', 'Games', 'Office', 'Pet', 'Baby', 'Tools', 'Crafts'],
        Department: ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance', 'Legal', 'Operations', 'Support', 'Design', 'Research',
            'QA', 'DevOps', 'Security', 'Analytics', 'Product'],
        Status: ['Active', 'Inactive', 'Pending', 'Completed', 'Failed'],
        Name: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack',
            'Kate', 'Leo', 'Mona', 'Nick', 'Olivia', 'Pat', 'Quinn', 'Ray', 'Sara', 'Tom',
            'Uma', 'Vic', 'Wendy', 'Xander', 'Yara', 'Zoe', 'Aaron', 'Beth', 'Carl', 'Dana'],
        Director: ['Steven Spielberg', 'James Cameron', 'Chris Columbus', 'George Lucas', 'Peter Jackson',
            'Robert Zemeckis', 'Michael Bay', 'Roland Emmerich', 'Gore Verbinski', 'Tim Burton',
            'Andrew Adamson', 'Sam Raimi', 'Ron Howard', 'Christopher Nolan', 'M. Night Shyamalan',
            'David Yates', 'John Lasseter', 'Carlos Saldanha', 'Andy Wachowski', 'Ridley Scott'],
        MovieTitle: ['The Dark Knight', 'Spider-Man', 'Avatar', 'Titanic', 'Jurassic Park', 'Star Wars',
            'The Matrix', 'Inception', 'Interstellar', 'Gladiator', 'The Avengers', 'Iron Man',
            'Frozen', 'Toy Story', 'Finding Nemo', 'Shrek', 'Cars', 'Up', 'WALL-E', 'Coco',
            'Moana', 'Ratatouille', 'Inside Out', 'Big Hero 6', 'Brave', 'Tangled', 'Zootopia',
            'The Lion King', 'Aladdin', 'Beauty and the Beast'],
    };
    const pool = pools[semanticType] || pools.Category;
    return pool.slice(0, Math.min(n, pool.length));
}

/** Generate n random unique names (first + last) for very large discrete tests */
export function genRandomNames(n: number, seed = 777): string[] {
    const firsts = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth',
        'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen',
        'Christopher', 'Lisa', 'Daniel', 'Nancy', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra',
        'Steven', 'Ashley', 'Paul', 'Dorothy', 'Andrew', 'Kimberly', 'Joshua', 'Emily', 'Kenneth', 'Donna'];
    const lasts = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
        'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
        'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
        'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'];
    const rand = seededRandom(seed);
    const names = new Set<string>();
    while (names.size < n) {
        const f = firsts[Math.floor(rand() * firsts.length)];
        const l = lasts[Math.floor(rand() * lasts.length)];
        names.add(`${f} ${l}`);
    }
    return [...names];
}

/** Generate random numeric measure values */
export function genMeasure(n: number, min = 10, max = 1000, integers = false): number[] {
    return Array.from({ length: n }, () => {
        const v = min + Math.random() * (max - min);
        return integers ? Math.round(v) : Math.round(v * 100) / 100;
    });
}
