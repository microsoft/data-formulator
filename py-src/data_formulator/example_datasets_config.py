# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Sample datasets configuration for Data Formulator.
"""

EXAMPLE_DATASETS = [
    {
        'source': 'vegadatasets',
        'name': 'Gapminder',
        'description': 'A simplified dataset of global development indicators tracking population, and life expectancy across countries over time.',
        'tables': [
            {
                "format": 'json',
                "url": 'https://cdn.jsdelivr.net/npm/vega-datasets@2.9.0/data/gapminder.json',
                "sample": [{"year": 1955, "country": "Afghanistan", "cluster": 0, "pop": 7971931, "life_expect": 43.88, "fertility": 7.42}, {"year": 1960, "country": "Afghanistan", "cluster": 0, "pop": 8622466, "life_expect": 45.03, "fertility": 7.38}, {"year": 1965, "country": "Afghanistan", "cluster": 0, "pop": 9565147, "life_expect": 46.13, "fertility": 7.35}, {"year": 1970, "country": "Afghanistan", "cluster": 0, "pop": 10752971, "life_expect": 47.08, "fertility": 7.4}, {"year": 1975, "country": "Afghanistan", "cluster": 0, "pop": 12157386, "life_expect": 47.55, "fertility": 7.54}, {"year": 1980, "country": "Afghanistan", "cluster": 0, "pop": 12486631, "life_expect": 43.68, "fertility": 7.59}, {"year": 1985, "country": "Afghanistan", "cluster": 0, "pop": 10512221, "life_expect": 42.03, "fertility": 7.52}, {"year": 1990, "country": "Afghanistan", "cluster": 0, "pop": 10694796, "life_expect": 53.83, "fertility": 7.57}, {"year": 1995, "country": "Afghanistan", "cluster": 0, "pop": 16418912, "life_expect": 54.33, "fertility": 7.71}, {"year": 2000, "country": "Afghanistan", "cluster": 0, "pop": 19542982, "life_expect": 54.73, "fertility": 7.53}, {"year": 2005, "country": "Afghanistan", "cluster": 0, "pop": 24411191, "life_expect": 57.63, "fertility": 6.91}, {"year": 1955, "country": "Argentina", "cluster": 3, "pop": 18700686, "life_expect": 64.51, "fertility": 3.14}, {"year": 1960, "country": "Argentina", "cluster": 3, "pop": 20349744, "life_expect": 65.26, "fertility": 3.08}, {"year": 1965, "country": "Argentina", "cluster": 3, "pop": 22053661, "life_expect": 66.13, "fertility": 3.06}, {"year": 1970, "country": "Argentina", "cluster": 3, "pop": 23842803, "life_expect": 66.13, "fertility": 3.09}, {"year": 1975, "country": "Argentina", "cluster": 3, "pop": 25875558, "life_expect": 68.03, "fertility": 3.3}, {"year": 1980, "country": "Argentina", "cluster": 3, "pop": 28024803, "life_expect": 70.23, "fertility": 3.3}, {"year": 1985, "country": "Argentina", "cluster": 3, "pop": 30287112, "life_expect": 71.73, "fertility": 3.1}, {"year": 1990, "country": "Argentina", "cluster": 3, "pop": 32637657, "life_expect": 72.47, "fertility": 3.03}, {"year": 1995, "country": "Argentina", "cluster": 3, "pop": 34946110, "life_expect": 73.44, "fertility": 2.86}, {"year": 2000, "country": "Argentina", "cluster": 3, "pop": 37070774, "life_expect": 74.22, "fertility": 2.59}]
            }
        ]
    },
    {
        'source': 'vegadatasets',
        'name': 'US Income',
        'description': 'US income distribution data showing how household incomes are spread across different brackets and states.',
        'tables': [
            {
                "format": 'json',
                "url": 'https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/income.json',
                "sample": [{"name":"Alabama","region":"south","id":1,"pct":0.102,"total":1837292,"group":"<10000"},{"name":"Alabama","region":"south","id":1,"pct":0.072,"total":1837292,"group":"10000 to 14999"},{"name":"Alabama","region":"south","id":1,"pct":0.13,"total":1837292,"group":"15000 to 24999"},{"name":"Alabama","region":"south","id":1,"pct":0.115,"total":1837292,"group":"25000 to 34999"},{"name":"Alabama","region":"south","id":1,"pct":0.143,"total":1837292,"group":"35000 to 49999"},{"name":"Alabama","region":"south","id":1,"pct":0.108,"total":1837292,"group":"75000 to 99999"}]
            }
        ]
    },
    {
        'source': 'vegadatasets',
        'name': 'Movies',
        'description': 'Box office performance, budgets, and ratings for films across different genres and time periods.',
        'tables': [
            {
                "format": 'json',
                "url": 'https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/movies.json',
                "sample": [
    {"Title": "The Land Girls", "US Gross": 146083, "Worldwide Gross": 146083, "US DVD Sales": None, "Production Budget": 8000000, "Release Date": "Jun 12 1998", "MPAA Rating": "R", "Running Time min": None, "Distributor": "Gramercy", "Source": None, "Major Genre": None, "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": None, "IMDB Rating": 6.1, "IMDB Votes": 1071},
    {"Title": "First Love, Last Rites", "US Gross": 10876, "Worldwide Gross": 10876, "US DVD Sales": None, "Production Budget": 300000, "Release Date": "Aug 07 1998", "MPAA Rating": "R", "Running Time min": None, "Distributor": "Strand", "Source": None, "Major Genre": "Drama", "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": None, "IMDB Rating": 6.9, "IMDB Votes": 207},
    {"Title": "I Married a Strange Person", "US Gross": 203134, "Worldwide Gross": 203134, "US DVD Sales": None, "Production Budget": 250000, "Release Date": "Aug 28 1998", "MPAA Rating": None, "Running Time min": None, "Distributor": "Lionsgate", "Source": None, "Major Genre": "Comedy", "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": None, "IMDB Rating": 6.8, "IMDB Votes": 865},
    {"Title": "Let's Talk About Sex", "US Gross": 373615, "Worldwide Gross": 373615, "US DVD Sales": None, "Production Budget": 300000, "Release Date": "Sep 11 1998", "MPAA Rating": None, "Running Time min": None, "Distributor": "Fine Line", "Source": None, "Major Genre": "Comedy", "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": 13, "IMDB Rating": None, "IMDB Votes": None},
    {"Title": "Slam", "US Gross": 1009819, "Worldwide Gross": 1087521, "US DVD Sales": None, "Production Budget": 1000000, "Release Date": "Oct 09 1998", "MPAA Rating": "R", "Running Time min": None, "Distributor": "Trimark", "Source": "Original Screenplay", "Major Genre": "Drama", "Creative Type": "Contemporary Fiction", "Director": None, "Rotten Tomatoes Rating": 62, "IMDB Rating": 3.4, "IMDB Votes": 165},
    {"Title": "Mississippi Mermaid", "US Gross": 24551, "Worldwide Gross": 2624551, "US DVD Sales": None, "Production Budget": 1600000, "Release Date": "Jan 15 1999", "MPAA Rating": None, "Running Time min": None, "Distributor": "MGM", "Source": None, "Major Genre": None, "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": None, "IMDB Rating": None, "IMDB Votes": None},
    {"Title": "Following", "US Gross": 44705, "Worldwide Gross": 44705, "US DVD Sales": None, "Production Budget": 6000, "Release Date": "Apr 04 1999", "MPAA Rating": "R", "Running Time min": None, "Distributor": "Zeitgeist", "Source": None, "Major Genre": None, "Creative Type": None, "Director": "Christopher Nolan", "Rotten Tomatoes Rating": None, "IMDB Rating": 7.7, "IMDB Votes": 15133},
    {"Title": "Foolish", "US Gross": 6026908, "Worldwide Gross": 6026908, "US DVD Sales": None, "Production Budget": 1600000, "Release Date": "Apr 09 1999", "MPAA Rating": "R", "Running Time min": None, "Distributor": "Artisan", "Source": "Original Screenplay", "Major Genre": "Comedy", "Creative Type": "Contemporary Fiction", "Director": None, "Rotten Tomatoes Rating": None, "IMDB Rating": 3.8, "IMDB Votes": 353},
    {"Title": "Pirates", "US Gross": 1641825, "Worldwide Gross": 6341825, "US DVD Sales": None, "Production Budget": 40000000, "Release Date": "Jul 01 1986", "MPAA Rating": "R", "Running Time min": None, "Distributor": None, "Source": None, "Major Genre": None, "Creative Type": None, "Director": "Roman Polanski", "Rotten Tomatoes Rating": 25, "IMDB Rating": 5.8, "IMDB Votes": 3275},
    {"Title": "Duel in the Sun", "US Gross": 20400000, "Worldwide Gross": 20400000, "US DVD Sales": None, "Production Budget": 6000000, "Release Date": "Dec 31 2046", "MPAA Rating": None, "Running Time min": None, "Distributor": None, "Source": None, "Major Genre": None, "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": 86, "IMDB Rating": 7, "IMDB Votes": 2906},
    {"Title": "Tom Jones", "US Gross": 37600000, "Worldwide Gross": 37600000, "US DVD Sales": None, "Production Budget": 1000000, "Release Date": "Oct 07 1963", "MPAA Rating": None, "Running Time min": None, "Distributor": None, "Source": None, "Major Genre": None, "Creative Type": None, "Director": None, "Rotten Tomatoes Rating": 81, "IMDB Rating": 7, "IMDB Votes": 4035}
]
            }
        ]
    },
    {
        'source': 'bls.gov',
        'name': 'Consumer Price Index',
        'description': 'Monthly average US retail prices (US city average) of eleven everyday items, such as eggs, milk, bread, gasoline and electricity, from 1995 to the latest month. Source: US Bureau of Labor Statistics.',
        # Rebuilt by scripts/refresh_example_datasets.py; previews come from the files.
        'tables': [
            {
                'format': 'csv',
                'url': 'example_datasets/average-price-data.csv',
            },
        ]
    },
    {
        'source': 'eia.gov',
        'name': 'Weekly Gas Price',
        'description': 'Weekly average US retail prices per gallon of gasoline, by grade and formulation, and of diesel, from 1990 to the latest week. Source: US Energy Information Administration.',
        # Rebuilt by scripts/refresh_example_datasets.py; previews come from the files.
        'tables': [
            {
                'format': 'csv',
                'url': 'example_datasets/weekly_gas_prices.csv',
            },
        ]
    },
    {
        'source': 'tidytuesday',
        'name': 'Netflix',
        'description': 'What movies and shows are we watching on Netflix?',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2025/2025-07-29/movies.csv',
                "sample": '''source,report,title,available_globally,release_date,hours_viewed,runtime,views
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Back in Action,Yes,2025-01-17,313000000,1H 54M 0S,164700000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,STRAW,Yes,2025-06-06,185200000,1H 48M 0S,102900000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,The Life List,Yes,2025-03-28,198900000,2H 5M 0S,95500000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Exterritorial,Yes,2025-04-30,159000000,1H 49M 0S,87500000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Havoc,Yes,2025-04-25,154900000,1H 47M 0S,86900000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,The Secret Life of Pets 2,No,NA,106800000,1H 26M 0S,74500000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,The Electric State,Yes,2025-03-14,158200000,2H 8M 0S,74200000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Counterattack // Contraataque,Yes,2025-02-28,101000000,1H 25M 0S,71300000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Ad Vitam,Yes,2025-01-10,114000000,1H 38M 0S,69800000''',
            },
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2025/2025-07-29/shows.csv',
                "sample": '''source,report,title,available_globally,release_date,hours_viewed,runtime,views
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Adolescence: Limited Series,Yes,2025-03-13,555100000,3H 50M 0S,144800000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Squid Game: Season 2 // 오징어 게임: 시즌 2,Yes,2024-12-26,840300000,7H 10M 0S,117300000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Squid Game: Season 3 // 오징어 게임: 시즌 3,Yes,2025-06-27,438600000,6H 8M 0S,71500000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Zero Day: Limited Series,Yes,2025-02-20,315800000,5H 9M 0S,61300000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Missing You: Limited Series,Yes,2025-01-01,218600000,3H 46M 0S,58000000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,American Murder: Gabby Petito: Season 1,Yes,2025-02-17,120600000,2H 9M 0S,56100000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Ms. Rachel: Season 1,Yes,NA,162100000,3H 2M 0S,53400000
1_What_We_Watched_A_Netflix_Engagement_Report_2025Jan-Jun,2025Jan-Jun,Sirens: Limited Series,Yes,2025-05-22,252300000,4H 44M 0S,53300000'''
            }
        ],
    },
    {
        'source': 'tidytuesday',
        'name': 'Nuclear Explosions',
        'description': 'This dataset is from Stockholm International Peace Research Institute, by way of data is plural with credit to Jesus Castagnetto for sharing the dataset.',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2019/2019-08-20/nuclear_explosions.csv',
                'sample': '''date_long,year,id_no,country,region,source,latitude,longitude,magnitude_body,magnitude_surface,depth,yield_lower,yield_upper,purpose,name,type
19450716,1945,45001,USA,ALAMOGORDO,DOE,32.54,-105.57,0,0,-0.1,21,21,WR,TRINITY,TOWER
19450805,1945,45002,USA,HIROSHIMA,DOE,34.23,132.27,0,0,-0.6,15,15,COMBAT,LITTLEBOY,AIRDROP
19450809,1945,45003,USA,NAGASAKI,DOE,32.45,129.52,0,0,-0.6,21,21,COMBAT,FATMAN,AIRDROP
19460630,1946,46001,USA,BIKINI,DOE,11.35,165.2,0,0,-0.2,21,21,WE,ABLE,AIRDROP
19460724,1946,46002,USA,BIKINI,DOE,11.35,165.2,0,0,0.03,21,21,WE,BAKER,UW
19480414,1948,48001,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.08,37,37,WR,X-RAY,TOWER
19480430,1948,48002,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.08,49,49,WR,YOKE,TOWER
19480514,1948,48003,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.08,18,18,WR,ZEBRA,TOWER
19490829,1949,49001,USSR,SEMI KAZAKH,DOE,48,76,0,0,0,22,22,WR,NA,SURFACE
19510127,1951,51001,USA,NTS,DOE,37,-116,0,0,-0.35,1,1,WR,ABLE,AIRDROP
19510128,1951,51002,USA,NTS,DOE,37,-116,0,0,-0.35,8,8,WR,BAKER,AIRDROP
19510201,1951,51003,USA,NTS,DOE,37,-116,0,0,-0.35,1,1,WR,EASY,AIRDROP
19510202,1951,51004,USA,NTS,DOE,37,-116,0,0,-0.4,8,8,WR,BAKER2,AIRDROP
19510206,1951,51005,USA,NTS,DOE,37,-116,0,0,-0.5,22,22,WR,FOX,AIRDROP
19510407,1951,51006,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.1,81,81,WR,DOG,TOWER
19510420,1951,51007,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.1,47,47,WR,EASY,TOWER
19510508,1951,51008,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.07,225,225,WR,GEORGE,TOWER
19510524,1951,51009,USA,ENEWETAK,DOE,11.3,162.15,0,0,-0.07,45.5,45.5,WR,ITEM,TOWER'''
            }
        ]
    },
    {
        'source': 'gcat',
        'name': 'Space launches',
        'description': 'Every orbital and deep-space launch attempt since Sputnik in 1957, with vehicle, mission, agency, launch site (with coordinates), orbit, payload mass and outcome, plus a table of launch agencies. Data from GCAT (J. McDowell, planet4589.org/space/gcat), CC-BY.',
        # Rebuilt by scripts/refresh_example_datasets.py; previews come from the files.
        'tables': [
            {
                'format': 'csv',
                'url': 'example_datasets/launches.csv',
            },
            {
                'format': 'csv',
                'url': 'example_datasets/agencies.csv',
            },
        ]
    },
]


