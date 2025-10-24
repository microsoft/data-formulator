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
                "url": 'https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/gapminder.json',
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
        'name': 'Disasters',
        'description': 'Historical records of natural disasters worldwide, including fatalities, types, and locations.',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/disasters.csv',
                "sample": '''Entity,Year,Deaths
All natural disasters,1900,1267360
All natural disasters,1901,200018
All natural disasters,1902,46037
All natural disasters,1903,6506
All natural disasters,1905,22758
All natural disasters,1906,42970
All natural disasters,1907,1325641
All natural disasters,1908,75033
All natural disasters,1909,1511524
All natural disasters,1910,148233
All natural disasters,1911,102408
All natural disasters,1912,52093
All natural disasters,1913,882
All natural disasters,1914,289'''
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
        'source': 'vegadatasets',
        'name': 'Unemployment',
        'description': 'Unemployment rates across different economic sectors and industries over time.',
        'tables': [
            {
                "format": 'json',
                "url": 'https://raw.githubusercontent.com/vega/vega-datasets/refs/heads/main/data/unemployment-across-industries.json',
                "sample": [{"series":"Government","year":2000,"month":1,"count":430,"rate":2.1,"date":"2000-01-01T08:00:00.000Z"},{"series":"Government","year":2000,"month":2,"count":409,"rate":2,"date":"2000-02-01T08:00:00.000Z"},{"series":"Government","year":2000,"month":3,"count":311,"rate":1.5,"date":"2000-03-01T08:00:00.000Z"},{"series":"Government","year":2000,"month":4,"count":269,"rate":1.3,"date":"2000-04-01T08:00:00.000Z"},{"series":"Government","year":2000,"month":5,"count":370,"rate":1.9,"date":"2000-05-01T07:00:00.000Z"},{"series":"Government","year":2000,"month":6,"count":603,"rate":3.1,"date":"2000-06-01T07:00:00.000Z"},{"series":"Government","year":2000,"month":7,"count":545,"rate":2.9,"date":"2000-07-01T07:00:00.000Z"},{"series":"Government","year":2000,"month":8,"count":583,"rate":3.1,"date":"2000-08-01T07:00:00.000Z"},{"series":"Government","year":2000,"month":9,"count":408,"rate":2.1,"date":"2000-09-01T07:00:00.000Z"},{"series":"Government","year":2000,"month":10,"count":391,"rate":2,"date":"2000-10-01T07:00:00.000Z"},{"series":"Government","year":2000,"month":11,"count":384,"rate":1.9,"date":"2000-11-01T08:00:00.000Z"},{"series":"Government","year":2000,"month":12,"count":365,"rate":1.8,"date":"2000-12-01T08:00:00.000Z"},{"series":"Government","year":2001,"month":1,"count":463,"rate":2.3,"date":"2001-01-01T08:00:00.000Z"},{"series":"Government","year":2001,"month":2,"count":298,"rate":1.5,"date":"2001-02-01T08:00:00.000Z"},{"series":"Government","year":2001,"month":3,"count":355,"rate":1.8,"date":"2001-03-01T08:00:00.000Z"},{"series":"Government","year":2001,"month":4,"count":369,"rate":1.9,"date":"2001-04-01T08:00:00.000Z"},{"series":"Government","year":2001,"month":5,"count":361,"rate":1.8,"date":"2001-05-01T07:00:00.000Z"},{"series":"Government","year":2001,"month":6,"count":525,"rate":2.7,"date":"2001-06-01T07:00:00.000Z"},{"series":"Government","year":2001,"month":7,"count":548,"rate":2.8,"date":"2001-07-01T07:00:00.000Z"},{"series":"Government","year":2001,"month":8,"count":540,"rate":2.8,"date":"2001-08-01T07:00:00.000Z"}]
            }
        ]
    },
    {
        'source': 'tidytuesday',
        'name': 'College Majors',
        'description': 'A dataset of college majors and their related fields',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2018/2018-10-16/recent-grads.csv',
                "sample":  '''Rank,Major_code,Major,Total,Men,Women,Major_category,ShareWomen,Sample_size,Employed,Full_time,Part_time,Full_time_year_round,Unemployed,Unemployment_rate,Median,P25th,P75th,College_jobs,Non_college_jobs,Low_wage_jobs
1,2419,PETROLEUM ENGINEERING,2339,2057,282,Engineering,0.120564344,36,1976,1849,270,1207,37,0.018380527,110000,95000,125000,1534,364,193
2,2416,MINING AND MINERAL ENGINEERING,756,679,77,Engineering,0.101851852,7,640,556,170,388,85,0.117241379,75000,55000,90000,350,257,50
3,2415,METALLURGICAL ENGINEERING,856,725,131,Engineering,0.153037383,3,648,558,133,340,16,0.024096386,73000,50000,105000,456,176,0
4,2417,NAVAL ARCHITECTURE AND MARINE ENGINEERING,1258,1123,135,Engineering,0.107313196,16,758,1069,150,692,40,0.050125313,70000,43000,80000,529,102,0
5,2405,CHEMICAL ENGINEERING,32260,21239,11021,Engineering,0.341630502,289,25694,23170,5180,16697,1672,0.061097712,65000,50000,75000,18314,4440,972
6,2418,NUCLEAR ENGINEERING,2573,2200,373,Engineering,0.144966965,17,1857,2038,264,1449,400,0.177226407,65000,50000,102000,1142,657,244
7,6202,ACTUARIAL SCIENCE,3777,2110,1667,Business,0.441355573,51,2912,2924,296,2482,308,0.095652174,62000,53000,72000,1768,314,259
8,5001,ASTRONOMY AND ASTROPHYSICS,1792,832,960,Physical Sciences,0.535714286,10,1526,1085,553,827,33,0.021167415,62000,31500,109000,972,500,220
9,2414,MECHANICAL ENGINEERING,91227,80320,10907,Engineering,0.119558903,1029,76442,71298,13101,54639,4650,0.057342278,60000,48000,70000,52844,16384,3253
10,2408,ELECTRICAL ENGINEERING,81527,65511,16016,Engineering,0.196450256,631,61928,55450,12695,41413,3895,0.059173845,60000,45000,72000,45829,10874,3170
11,2407,COMPUTER ENGINEERING,41542,33258,8284,Engineering,0.199412643,399,32506,30315,5146,23621,2275,0.065409275,60000,45000,75000,23694,5721,980'''
            }
        ]
    },{
        'source': 'bls.gov',
        'name': 'Consumer Price Index',
        'description': 'Average price of consumer goods and services in the United States',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://gist.githubusercontent.com/Chenglong-MS/75827bc7daac7ba407863f499c494b37/raw/95af6fd0cc978932af9f6cacc7cd3c0c01d4dffa/average-price-data.csv',
                "sample": '''Month,"Bananas per lb.","Oranges Navel per lb.","Bread white pan per lb.","Tomatoes field grown per lb.","Chicken fresh whole per lb.",Electricity per KWH,"Eggs grade A large per doz.","Gasoline unleaded regular per gallon","Ground chuck 100% beef per lb.",Utility (piped) gas per therm,"Milk fresh whole fortified per gal."
2005-08-01,0.487,,1.06,1.416,1.042,0.105,1.166,2.506,2.502,1.189,3.136
2005-09-01,0.485,1.363,1.052,1.429,1.056,0.106,1.279,2.927,2.535,1.324,3.133
2005-10-01,0.491,1.388,1.043,1.547,1.062,0.102,1.264,2.785,2.564,1.512,3.171
2005-11-01,0.48,1.172,1.055,1.574,1.059,0.102,1.279,2.343,2.568,1.548,3.211
2005-12-01,0.482,0.885,1.046,1.848,1.061,0.102,1.35,2.186,2.606,1.498,3.241
2006-01-01,0.49,0.837,1.046,2.162,1.062,0.108,1.449,2.315,2.607,1.531,3.197
2006-02-01,0.508,0.915,1.029,1.91,1.045,0.108,1.328,2.31,2.556,1.402,3.224
2006-03-01,0.508,0.888,1.04,1.649,1.047,0.109,1.302,2.401,2.568,1.335,3.161
2006-04-01,0.508,0.876,1.072,1.573,1.054,0.109,1.283,2.757,2.599,1.278,3.123
2006-05-01,0.514,0.99,1.086,1.543,1.034,0.11,1.206,2.947,2.508,1.263,3.066
2006-06-01,0.511,1.119,1.074,1.457,1.055,0.118,1.242,2.917,2.543,1.21,3.001''',
            }
        ]
    },
    {
        'source': 'tidytuesday',
        'name': 'Weekly Gas Price',
        'description': 'Weekly gas prices in US for different grades and formulations',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2025/2025-07-01/weekly_gas_prices.csv',
                "sample": '''date,fuel,grade,formulation,price
1990-08-20,gasoline,regular,all,1.191
1990-08-27,gasoline,regular,all,1.245
1990-08-27,gasoline,regular,conventional,1.245
1990-09-03,gasoline,regular,all,1.242
1990-09-03,gasoline,regular,conventional,1.242
1990-09-10,gasoline,regular,all,1.252
1990-09-10,gasoline,regular,conventional,1.252
1990-09-17,gasoline,regular,all,1.266
1990-09-17,gasoline,regular,conventional,1.266
1990-09-24,gasoline,regular,all,1.272
1990-09-24,gasoline,regular,conventional,1.272
1990-10-01,gasoline,regular,all,1.321
1990-10-01,gasoline,regular,conventional,1.321
1990-10-08,gasoline,regular,all,1.333
1990-10-08,gasoline,regular,conventional,1.333
1990-10-15,gasoline,regular,all,1.339
1990-10-15,gasoline,regular,conventional,1.339'''
            }
        ]
    }, {
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
    }, {
        'source': 'tidytuesday',
        'name': 'Billboard Hot 100',
        'description': 'Data about every song to ever top the Billboard Hot 100 between August 4, 1958 and January 11, 2025. It was compiled by Chris Dalla Riva as he wrote the book Uncharted Territory: What Numbers Tell Us about the Biggest Hit Songs and Ourselves.',
        'tables': [   
            {
                "format": 'csv',
                'url': 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2025/2025-08-26/billboard.csv',
                'sample': '''song,artist,date,weeks_at_number_one,non_consecutive,rating_1,rating_2,rating_3,overall_rating,divisiveness,label,parent_label,cdr_genre,cdr_style,discogs_genre,discogs_style,artist_structure,featured_artists,multiple_lead_vocalists,group_named_after_non_lead_singer,talent_contestant,posthumous,artist_place_of_origin,front_person_age,artist_male,artist_white,artist_black,songwriters,songwriters_w_o_interpolation_sample_credits,songwriter_male,songwriter_white,artist_is_a_songwriter,artist_is_only_songwriter,producers,producer_male,producer_white,artist_is_a_producer,artist_is_only_producer,songwriter_is_a_producer,time_signature,keys,simplified_key,bpm,energy,danceability,happiness,loudness_d_b,acousticness,vocally_based,bass_based,guitar_based,piano_keyboard_based,orchestral_strings,horns_winds,accordion,banjo,bongos,clarinet,cowbell,falsetto_vocal,flute_piccolo,handclaps_snaps,harmonica,human_whistling,kazoo,mandolin,pedal_lap_steel,ocarina,saxophone,sitar,trumpet,ukulele,violin,sound_effects,song_structure,rap_verse_in_a_non_rap_song,length_sec,instrumental,instrumental_length_sec,intro_length_sec,vocal_introduction,free_time_vocal_introduction,fade_out,live,cover,sample,interpolation,inspired_by_a_different_song,lyrics,lyrical_topic,lyrical_narrative,spoken_word,explicit,foreign_language,written_for_a_play,featured_in_a_then_contemporary_play,written_for_a_film,featured_in_a_then_contemporary_film,written_for_a_t_v_show,featured_in_a_then_contemporary_t_v_show,associated_with_dance,topped_the_charts_by_multiple_artist,double_a_side,eurovision_entry,u_s_artwork
Poor Little Fool,Ricky Nelson,1958-08-04T00:00:00Z,2,0,4,5,3,4,1.3333333333333333,Imperial,Imperial,Pop;Rock,Acoustic Rock,Rock,Rock & Roll,1,NA,0,0,NA,0,United States,18,1,1,0,Sharon Sheeley,Sharon Sheeley,0,1,0,0,Jimmie Haskell;Ozzie Nelson;Ricky Nelson,1,1,1,0,0,4/4,C,C,155,33,54,80,-12,67,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,A2,0,154,0,12,12,0,0,0,0,0,0,0,0,I used to play around with hearts.That hastened at my call.But when I met that little girl.I knew that I would fall.Poor little fool oh yeah.I was a fool uh huh.Oh oh poor little fool.I was a fool oh yeah.She played around and teased me.With her carefree devil eyes.She'd hold me close and kiss me.But her heart was full of lies.Poor little fool oh yeah.I was a fool uh huh.Oh oh poor little fool.I was a fool oh yeah.She told me how she cared for me.And that we'd never part.And so for the very first time.I gave away my heart.Poor little fool oh yeah.I was a fool uh huh.Oh oh poor little fool.I was a fool oh yeah.The next day she was gone.And I knew she'd lied to me.She left me with a broken heart.And won her victory.Poor little fool oh yeah.I was a fool uh huh.Oh oh poor little fool.I was a fool oh yeah.Well I'd played this game with other hearts.But I never thought I'd see.The day that someone else would play.Love's foolish game with me.Poor little fool oh yeah.I was a fool uh huh.Oh oh poor little fool.I was a fool oh yeah.Poor little fool oh yeah.I was a fool uh huh.Oh oh poor little fool.Poor little fool.,Lost Love,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
Nel Blu Dipinto Di Blu,Domenico Modugno,1958-08-18T00:00:00Z,5,1,7,7,5,6.333333333333333,1.3333333333333333,Decca,Decca,Pop,Vocal,"Pop;Folk, World, & Country",Vocal;Canzone Napoletana;Ballad,1,NA,0,0,NA,0,Italy,30,1,1,0,Franco Migliacci;Domenico Modugno;Mitchell Parish,Franco Migliacci;Domenico Modugno;Mitchell Parish,1,1,1,0,Unknown,NA,NA,NA,NA,0,Free;6/8;4/4,Bb,Bb,130,6,55,48,-17,98,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,E1,0,219,0,11,40,1,1,0,0,0,0,0,0,NA,Flying;Dreaming,0,0,0,1,0,NA,0,NA,0,NA,0,0,NA,1,Cannot Locate
Little Star,The Elegants,1958-08-25T00:00:00Z,1,0,5,6,6,5.666666666666667,0.6666666666666666,Apt,ABC,Rock,Rock & Roll,Rock,Rock & Roll;Doo Wop,0,NA,0,0,NA,0,United States,17,1,1,0,Vito Picone;Arthur Venosa,Vito Picone;Arthur Venosa,1,1,1,1,Unknown,NA,NA,NA,NA,0,Free;4/4,A,A,73,40,41,70,-13,87,1,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,D3,0,163,0,0,10,1,1,0,0,0,0,1,1,Where are you little star.Where are you.Twinkle twinkle little star.How I wonder where you are.Wish I may wish I might.Make this wish come true tonight.Searched all over for a love.You're the one I'm thinking of.Twinkle twinkle little star.How I wonder where you are.High above the clouds somewhere.Send me down a love to share.Oh there you are.High above.Oh oh God.Send me a love.Oh there you are.Lighting up the sky.I need a love.Oh me oh me oh my.Twinkle twinkle little star.How I wonder where you are.Wish I may wish I might.Make this wish come true tonight.There you are little star.,Longing for Love,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
It's All in the Game,Tommy Edwards,1958-09-29T00:00:00Z,6,0,3,3,7,4.333333333333333,2.6666666666666665,MGM,MGM,Pop,Vocal,Rock;Pop,Ballad;Doo Wop,1,NA,0,0,NA,0,United States,35,1,0,1,Carl Sigman;Charles G. Dawes,Carl Sigman;Charles G. Dawes,1,1,0,0,Harry Myerson,1,1,0,0,0,3/4,Eb,Eb,71,15,33,61,-18,4,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,D1,0,156,0,0,3,0,0,0,0,0,0,1,1,Many a tear have to fall.But it's all in the game.All in the wonderful game.That we know as love.You have words with him.And your future's looking dim.But these things.Your hearts can rise above.Once in a while he will call.But it's all in the game.Soon he'll be there at your side.With a sweet bouquet.And he'll kiss your lips.And caress your waiting fingertips.And your hearts will fly.Away.Soon he'll be there at your side.With a sweet bouquet.Then he'll kiss your lips.And caress your waiting fingertips.And your hearts will fly.Away.,Love,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
It's Only Make Believe,Conway Twitty,1958-11-10T00:00:00Z,2,1,7,8,9,8,1.3333333333333333,MGM,MGM,Pop,Vocal,Rock,Rock & Roll;Pop Rock,1,NA,0,0,NA,0,United States,25,1,1,0,Jack Nance;Conway Twitty,Jack Nance;Conway Twitty,1,1,1,0,Jim Vienneau,1,1,0,0,0,Free;6/8,B,B,127,43,44,36,-10,86,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,A3,0,134,0,0,24,1,1,0,0,0,0,0,0,People see us everywhere.They think you really care.But myself I can't deceive.I know it's only make believe.My one and only prayer.Is that someday you'll care.My hopes my dreams come true.My one and only you.No one will ever know.How much I love you so.My only prayer will be.Someday you'll care for me.But it's only make believe.My hopes my dreams come true.My life I'd give for you.My heart a wedding ring.My all my everything.My heart I can't control.You rule my very soul.My only prayer will be.Someday you'll care for me.But it's only make believe.My one and only prayer.Is that someday you'll care.My hopes my dreams come true.My one and only you.No one will ever know.How much I love you so.My prayers my hopes my schemes.You are my every dream.But it's only make believe.,Lost Love,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
Tom Dooley,The Kingston Trio,1958-11-17T00:00:00Z,1,0,5,5,2,4,2,Capitol,EMI,Folk/Country,Folk,"Folk, World, & Country",Folk,0,NA,0,0,NA,0,United States,24.333333333333332,1,1,0,Alan Lomax;Frank Warner,Alan Lomax;Frank Warner,1,1,0,0,Voyle Gilmore,1,1,0,0,0,4/4,E,E,126,14,63,52,-15,83,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,C2,0,185,0,7,31,1,0,0,0,1,0,0,1,Throughout history there have been many songs written about the eternal triangle. This next one tells the story of Mister Grayson a beautiful woman and a condemned man named Tom Dooley. When the sun rises tomorrow Tom Dooley must hang.Hang down your head Tom Dooley.Hang down your head and cry.Hang down your head Tom Dooley.Poor boy you're bound to die.I met her on the mountain.There I took her life.Met her on the mountain.Stabbed her with my knife.Hang down your head Tom Dooley.Hang down your head and cry.Hang down your head Tom Dooley.Poor boy you're bound to die.This time tomorrow.Reckon where I'll be.Hadn't a been for Grayson.I'd a been in Tennessee.Well now boy.Hang down your head Tom Dooley.Hang down your head and cry.Hang down your head Tom Dooley.Poor boy you're bound to die.Hang down your head and try Tom Dooley.Hang down your head and cry.Hang down your head and try Tom Dooley.Poor boy you're bound to die.This time tomorrow.Reckon where I'll be.Down in some lonesome valley.Hanging from a white oak tree.Hang down your head Tom Dooley.Hang down your head and cry.Hang down your head Tom Dooley.Poor boy you're bound to die.Well now boy.Hang down your head Tom Dooley.Hang down your head and cry.Hang down your head Tom Dooley.Poor boy you're bound to die.Poor boy you're bound to die.Poor boy you're bound to die.Poor boy you're bound to die.,Murder;Death,1,1,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
To Know Him is to Love Him,The Teddy Bears,1958-12-01T00:00:00Z,3,0,8,8,8,8,0,Dore,Dore,Pop,Vocal,Pop,Vocal;Ballad,0,NA,0,0,NA,0,United States,18,2,1,0,Phil Spector,Phil Spector,1,1,1,1,Phil Spector,1,1,1,1,1,12/8,D;F,Multiple Keys,175,20,32,35,-16,89,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,D1,0,142,0,8,8,0,0,1,0,0,0,0,0,To know know know him.Is to love love love him.Just to see him smile.Makes my life worthwhile.To know know know him.Is to love love love him.And I do.And I do and I.And I do and I.And I do and I.And I do and I.I'd be good to him.I'd bring love to him.Everyone says there'll come a day.When I'll walk along side of him.Yes yes to know him.Is to love love love him.And I do.And I do and I.And I do and I.And I do and I.And I do and I.Why can't he see.How blind can he be.Someday he will see that he.Was meant for me.Oh oh yes.To know know know him.Is to love love love him.Just to see him smile.Makes my life worthwhile.To know know know him.Is to love love love him.And I do.And I do and I.And I do and I.And I do and I.And I do and I.,Longing for Love,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
The Chipmunk Song,The Chipmunks,1958-12-22T00:00:00Z,4,0,1,5,2,2.6666666666666665,2.6666666666666665,Liberty,Liberty,Pop,Novelty;Holiday,Pop;Children's,Novelty,0,NA,0,0,NA,0,United States,39,1,0,0,Ross Bagdasarian Sr.,Ross Bagdasarian Sr.,1,0,1,1,Ross Bagdasarian Sr.,1,0,1,1,1,3/4,Ab;Bb&%,Ab,153,37,61,78,-12,71,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,A2,0,141,0,28,19,0,0,1,0,0,0,0,0,Alright you Chipmunks Ready to sing your song.I'd say we are.Yeah Lets sing it now.Okay Simon.Okay.Okay Theodore.Okay.Okay Alvin Alvin Alvin.Okay.Christmas Christmas time is near.Time for toys and time for cheer.We've been good but we can't last.Hurry Christmas hurry fast.Want a plane that loops the loop.Me I want a Hula-Hoop.We can hardly stand the wait.Please Christmas don't be late.Ok Fellas Get ready.That was very good Simon.Naturally.Very Good Theodore.He He He He.Uh Alvin You were a little flat.Watch it Alvin Alvin Alvin.Okay.Want a plane that loops the loop.I still want a Hula-Hoop.We can hardly stand the wait.Please Christmas don't be late.We can hardly stand the wait.Please Christmas don't be late.,Christmas,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
Smoke Gets in Your Eyes,The Platters,1959-01-19T00:00:00Z,3,0,9,9,8,8.666666666666666,0.6666666666666666,Mercury,Mercury,Pop,Vocal,Funk/Soul,Rhythm & Blues,0,NA,0,0,NA,0,United States,30,2,0,1,Otto Harbach;Jerome Kern,Otto Harbach;Jerome Kern,1,1,0,0,Buck Ram,1,1,0,0,0,4/4,Eb;B,Multiple Keys,113,27,32,26,-11,93,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,D1,0,158,0,16,8,0,0,0,0,1,0,0,1,They asked me how I knew.My true love was true.I of course replied.Something here inside.Cannot be denied.They said someday you'll find.All who love are blind.When your heart's on fire.You must realize.Smoke gets in your eyes.So I chaffed them and I gaily laughed.To think they could doubt my love.And yet today my love has flown away.I am without my love.Now laughing friends deride.Tears I cannot hide.So I smile and say.When a lovely flame dies.Smoke gets in your eyes.Smoke gets in your eyes.,Lost Love,0,0,0,0,1,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
Stagger Lee,Lloyd Price,1959-02-02T00:00:00Z,4,0,6,6,9,7,2,ABC-Paramount,ABC,Rock,Rhythm & Blues,Rock,Rock & Roll,1,NA,0,0,NA,0,United States,25,1,0,1,Lloyd Price;Harold Logan,Lloyd Price;Harold Logan,1,0,1,0,Don Costa,1,1,0,0,0,Free;4/4,Eb,Eb,71,62,36,79,-8,74,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,A4,0,145,0,32,13,1,1,1,0,1,0,0,1,The night was clear.And the moon was yellow.And the leaves came tumbling down.I was standing on the corner.When I heard my bulldog bark.He was barking at the two men.Who were gambling in the dark.It was Stagger Lee and Billy.Two men who gambled late.Stagger Lee threw seven.Billy swore that he threw eight.Stagger Lee told Billy.I can't let you go with that.You have won all my money.And my brand new Stetson hat.Stagger Lee started off.Going down that railroad track.He said I can't get you Billy.But don't be here when I come back.Go on Stagger Lee.Stagger Lee went home.And he got his forty-four.Said I'm going to the bar room.Just to pay that debt I owe.Stagger Lee went to the bar room.And he stood across the bar room door.Said Now nobody move.And he pulled his forty-four.Stagger Lee cried Billy.Oh please don't take my life.I got three little children.And a very sickly wife.Stagger Lee shot Billy.Oh he shot that poor boy so bad.Till the bullet came through Billy.And it broke the bartender's glass.Now look out Stagg come on.,Murder;Death,1,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Cannot Locate
Venus,Frankie Avalon,1959-03-09T00:00:00Z,5,0,3,2,2,2.3333333333333335,0.6666666666666666,Chancellor,ABC,Pop,Vocal,Pop,Vocal,1,NA,0,0,NA,0,United States,18,1,1,0,Ed Marshall,Ed Marshall,1,1,0,0,Peter DeAngelis;Bob Marcucci,1,1,0,0,0,4/4,Bb,Bb,115,48,56,75,-10,73,1,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NA,D1,0,142,0,23,16,0,0,0,0,0,0,0,0,Venus.Venus.Venus if you will.Please send a little girl for me to thrill.A girl who wants my kisses and my arms.A girl with all the charms of you.Venus make her fair.A lovely girl with sunlight in her hair.And take the brightest stars up in the skies.And place them in her eyes for me.Venus goddess of love that you are.Surely the things I ask.Can't be too great a task.Venus if you do.I promise that I always will be true.I'll give her all the love I have to give.As long as we both shall live.Venus goddess of love that you are.Surely the things I ask.Can't be too great a task.Venus if you do.I promise that I always will be true.I'll give her all the love I have to give.As long as we both shall live.Venus.Venus.Make my wish come true.,Longing for Love,0,0,0,0,0,NA,0,NA,0,NA,0,0,NA,0,Artist Photograph'''
            }
        ]
    }, {
        'source': 'tidytuesday',
        'name': 'Patient Risk Profiles',
        'description': "This dataset contains 100 simulated patient's medical history features and the predicted 1-year risk of 14 outcomes based on each patient's medical history features. The predictions used real logistic regression models developed on a large real world healthcare dataset.",
        'tables': [
            {
                "format": 'csv',
                'url': 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2023/2023-10-24/patient_risk_profiles.csv',
                'sample': '''personId,age group:  10 -  14,age group:  15 -  19,age group:  20 -  24,age group:  65 -  69,age group:  40 -  44,age group:  45 -  49,age group:  55 -  59,age group:  85 -  89,age group:  75 -  79,age group:   5 -   9,age group:  25 -  29,age group:   0 -   4,age group:  70 -  74,age group:  50 -  54,age group:  60 -  64,age group:  35 -  39,age group:  30 -  34,age group:  80 -  84,age group:  90 -  94,Sex = FEMALE,Sex = MALE,Acetaminophen exposures in prior year,Occurrence of Alcoholism in prior year,Anemia in prior year,Angina events in prior year,ANTIEPILEPTICS in prior year,Occurrence of Anxiety in prior year,Osteoarthritis in prior year,Aspirin exposures in prior year,Occurrence of Asthma in prior year,"Atrial Fibrillation, incident in prior year",HORMONAL CONTRACEPTIVES in prior year,Any cancer (excl. prostate cancer and benign cancer) in prior year,Acute Kidney Injury (AKI) in prior year,Chronic kidney disease or end stage renal disease in prior year,Heart failure in prior year,Chronic obstructive pulmonary disease (COPD) in prior year,Coronary artery disease (CAD) in prior year,"Major depressive disorder, with NO occurrence of certain psychiatric disorder in prior year",Type 1 diabetes and no prior specific non-T1DM diabetes in prior year,"Type 2 Diabetes Mellitus (DM), with no type 1 or secondary DM in prior year",Deep Vein Thrombosis (DVT) in prior year,Dyspnea in prior year,Edema in prior year,Gastroesophageal reflux disease in prior year,Acute gastrointestinal (GI) bleeding in prior year,Heart valve disorder in prior year,Chronic hepatitis in prior year,Hyperlipidemia in prior year,Hypertension in prior year,Hypothyroidism in prior year,Inflammatory Bowel Disease in prior year,Low back pain in prior year,Occurrence of neuropathy in prior year,Obesity in prior year,Opioids in prior year,Osteoporosis in prior year,Peripheral vascular disease in prior year,Pneumonia in prior year,Psychotic disorder in prior year,Acute Respiratory failure in prior year,Rheumatoid Arthritis in prior year,Seizure in prior year,Sepsis in prior year,Skin ulcer in prior year,Sleep apnea in prior year,Smoking in prior year,STEROIDS in prior year,Hemorrhagic stroke in an inpatient setting in prior year,Non-hemorrhagic Stroke in an inpatient setting in prior year,Urinary tract infectious disease in prior year,Antibiotics Carbapenems in prior year,Antibiotics Aminoglycosides in prior year,Antibiotics Cephalosporins in prior year,Antibiotics Fluoroquinolones in prior year,Antibiotics Glycopeptides and lipoglycopeptides in prior year,Antibiotics Macrolides in prior year,Antibiotics Monobactams in prior year,Antibiotics Oxazolidinones in prior year,Antibiotics Penicillins in prior year,Antibiotics Polypeptides in prior year,Antibiotics Rifamycins in prior year,Antibiotics Sulfonamides in prior year,Antibiotics Streptogramins in prior year,Antibiotics Tetracyclines in prior year,predicted risk of Pulmonary Embolism,"predicted risk of Sudden Hearing Loss, No congenital anomaly or middle or inner ear conditions",predicted risk of Restless Leg Syndrome,"predicted risk of Sudden Vision Loss, with no eye pathology causes",predicted risk of Muscle weakness or injury,predicted risk of Ankylosing Spondylitis,predicted risk of Autoimmune hepatitis,predicted risk of Multiple Sclerosis,"predicted risk of Acute pancreatitis, with No chronic or hereditary or common causes of pancreatitis",predicted risk of Ulcerative colitis,predicted risk of Migraine,predicted risk of Dementia,predicted risk of  Treatment resistant depression (TRD),"predicted risk of Parkinson's disease, inpatient or with 2nd diagnosis"
1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,1,0,0,1,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,1,0,1,0,1,0,0,0,0,0,0,0,6.99575517946153E-06,0.00118799448452361,0.00113521200511238,0.000111508301767788,0.0188317440572134,7.58027636940557E-05,7.96570781215902E-05,0.000468549568476105,0.00012436069695809,0.000230991182800591,0.00654426768381862,7.30568202867115E-05,0.000393828939554244,4.04339639325133E-05
2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0,1,1,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,1,0,1,0,0,0,0,0,1,0,1,1,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0,1,0.00441422061324454,0.0358259270965809,0.00628615304402316,0.00160728545057666,0.179579353683346,0.000501552796659848,7.88137732912271E-06,0.000421360646091043,0.000816636102151383,0.00156719415098486,0.0243635943152779,0.283879214688442,0.0138886132877911,0.0195526139594774
3,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0.00246179423902851,0.00352409954417798,0.00123963239201273,0.000145891713126901,0.0223178022257278,0.000461715423994332,2.28874258509341E-05,0.000527096330768595,0.000416669691599939,0.00127466041950367,0.00542984527203618,0.00128155335881044,0.00101738679514043,0.000113499343433664
4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,1,1,0,1,0,0,0,0,0,0,1,0,0,0,1,1,1,0.00267000861643238,0.00247336321987715,0.000441054921283152,0.000152773704749624,0.0220617756570553,0.000481510930093349,3.43010599599209E-05,0.000910960176825296,0.000235986486697154,0.00638625829979481,0.006636578736903,0.000706627519596284,0.00226615949859508,4.10984109899065E-05
5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,1,0,0,1,0,1,0,0,0,0,0,0,1,1,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,1,0,1,0,0,1,0,0,0,0,0,0,1,0,0.0206818512182543,0.0117893418676085,0.00427664772229725,0.000325865473878066,0.0633105390455467,0.0041153809531189,8.3473321779432E-05,0.00185928919073779,0.000699811142238753,0.0620649084463635,0.00468263807806029,0.0163716009191329,5.64951086173088E-05,0.00331195228607955
6,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0.00455665231961284,0.0215984207477867,0.00178776442479255,0.000466726635059575,0.0389368132012184,0.000666036384000457,2.15545946607044E-05,0.000127202886974176,0.000858813148174222,0.0010155590042039,0.0100388811465988,0.0457689464750165,0.000659150042438028,0.00336552536596351
7,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0,1,1,0,0,0,0,1,0,0,1,0,1,1,1,0,1,0,0,1,0,1,1,0,0,0,1,0,1,0,0,0,0,0,0,0,1,0,0,1,0,1,0,0,0,0.0186826613299857,0.0187010037764903,0.00212554337046552,0.000214068587596829,0.134144553239361,0.00108141814357676,0.00139509039790527,0.000744241842425037,0.000916803656046385,0.00637231340606943,0.0326189204574906,0.331324640121089,0.000314660993270718,0.00498660937569948
'''
            }
        ]
    }, {
        'source': 'tidytuesday',
        'name': 'Life Expectancy',
        'description': 'Across the world, people are living longer. In 1900, the average life expectancy of a newborn was 32 years. By 2021 this had more than doubled to 71 years. But where, when, how, and why has this dramatic change occurred? To understand it, we can look at data on life expectancy worldwide.',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2023/2023-12-05/life_expectancy.csv',
                'sample': '''Entity,Code,Year,LifeExpectancy
Afghanistan,AFG,1950,27.7275
Afghanistan,AFG,1951,27.9634
Afghanistan,AFG,1952,28.4456
Afghanistan,AFG,1953,28.9304
Afghanistan,AFG,1954,29.2258
Afghanistan,AFG,1955,29.9206
Afghanistan,AFG,1956,30.4078
Afghanistan,AFG,1957,30.9458
'''
            }, {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2023/2023-12-05/life_expectancy_different_ages.csv',
                'sample': '''Entity,Code,Year,LifeExpectancy0,LifeExpectancy10,LifeExpectancy25,LifeExpectancy45,LifeExpectancy65,LifeExpectancy80
Afghanistan,AFG,1950,27.7275,49.1459,54.4422,63.4225,73.4901,83.7259
Afghanistan,AFG,1951,27.9634,49.2941,54.5644,63.500603,73.5289,83.7448
Afghanistan,AFG,1952,28.4456,49.5822,54.7998,63.6476,73.6018,83.7796
Afghanistan,AFG,1953,28.9304,49.8634,55.028603,63.788902,73.6706,83.8118
Afghanistan,AFG,1954,29.2258,49.9306,55.1165,63.8481,73.7041,83.8334
Afghanistan,AFG,1955,29.9206,50.4315,55.4902,64.0732,73.8087,83.876
Afghanistan,AFG,1956,30.4078,50.7036,55.7131,64.2102,73.8755,83.9073
Afghanistan,AFG,1957,30.9458,51.0233,55.9721,64.3705,73.9542,83.9434
Afghanistan,AFG,1958,31.5066,51.3565,56.244698,64.5401,74.0384,83.9826'''
            }, {
                "format": 'csv',
                'url': 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2023/2023-12-05/life_expectancy_female_male.csv',
                'sample': '''Entity,Code,Year,LifeExpectancyDiffFM
Afghanistan,AFG,1950,1.2619
Afghanistan,AFG,1951,1.2706013
Afghanistan,AFG,1952,1.2882996
Afghanistan,AFG,1953,1.3066006
Afghanistan,AFG,1954,1.2765007
Afghanistan,AFG,1955,1.3688011
Afghanistan,AFG,1956,1.4055996
Afghanistan,AFG,1957,1.4146996
Afghanistan,AFG,1958,1.3987999
Afghanistan,AFG,1959,1.3992996
Afghanistan,AFG,1960,1.4146004'''
            }
        ]
    }, {
        'source': 'tidytuesday',
        'name': 'PhDs Awarded',
        'description': 'The data comes from the NSF - where there are at least 72 different datasets if you wanted to approach the data from a different angle.',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2019/2019-02-19/phd_by_field.csv',
                'sample': '''broad_field,major_field,field,year,n_phds
Life sciences,Agricultural sciences and natural resources,Agricultural economics,2008,111
Life sciences,Agricultural sciences and natural resources,Agricultural and horticultural plant breeding,2008,28
Life sciences,Agricultural sciences and natural resources,Agricultural animal breeding,2008,3
Life sciences,Agricultural sciences and natural resources,Agronomy and crop science,2008,68
Life sciences,Agricultural sciences and natural resources,Animal nutrition,2008,41
Life sciences,Agricultural sciences and natural resources,"Animal science, poultry or avian",2008,18
Life sciences,Agricultural sciences and natural resources,"Animal sciences, other",2008,77
Life sciences,Agricultural sciences and natural resources,Environmental science,2008,182
Life sciences,Agricultural sciences and natural resources,Fishing and fisheries sciences and management,2008,52
Life sciences,Agricultural sciences and natural resources,Food science,2008,96
Life sciences,Agricultural sciences and natural resources,"Food science and technology, other",2008,41
Life sciences,Agricultural sciences and natural resources,Forest sciences and biology,2008,32
Life sciences,Agricultural sciences and natural resources,"Forest management, forest resources management",2008,44
Life sciences,Agricultural sciences and natural resources,"Forestry, other",2008,17
Life sciences,Agricultural sciences and natural resources,Horticulture science,2008,50
Life sciences,Agricultural sciences and natural resources,Natural resource and environmental policy,2008,NA
'''
            }
        ]
    }, {
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
    }, {
        'source': 'tidytuesday',
        'name': 'Nobel Laureate',
        'description': '"The Nobel Prize is a set of annual international awards bestowed in several categories by Swedish and Norwegian institutions in recognition of academic, cultural, or scientific advances." - Wikipedia.',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2019/2019-05-14/nobel_winners.csv',
                'sample': '''prize_year,category,prize,motivation,prize_share,laureate_id,laureate_type,full_name,birth_date,birth_city,birth_country,gender,organization_name,organization_city,organization_country,death_date,death_city,death_country
1901,Chemistry,The Nobel Prize in Chemistry 1901,"""in recognition of the extraordinary services he has rendered by the discovery of the laws of chemical dynamics and osmotic pressure in solutions""",1/1,160,Individual,Jacobus Henricus van 't Hoff,1852-08-30,Rotterdam,Netherlands,Male,Berlin University,Berlin,Germany,1911-03-01,Berlin,Germany
1901,Literature,The Nobel Prize in Literature 1901,"""in special recognition of his poetic composition, which gives evidence of lofty idealism, artistic perfection and a rare combination of the qualities of both heart and intellect""",1/1,569,Individual,Sully Prudhomme,1839-03-16,Paris,France,Male,NA,NA,NA,1907-09-07,Châtenay,France
1901,Medicine,The Nobel Prize in Physiology or Medicine 1901,"""for his work on serum therapy, especially its application against diphtheria, by which he has opened a new road in the domain of medical science and thereby placed in the hands of the physician a victorious weapon against illness and deaths""",1/1,293,Individual,Emil Adolf von Behring,1854-03-15,Hansdorf (Lawice),Prussia (Poland),Male,Marburg University,Marburg,Germany,1917-03-31,Marburg,Germany
1901,Peace,The Nobel Peace Prize 1901,NA,1/2,462,Individual,Jean Henry Dunant,1828-05-08,Geneva,Switzerland,Male,NA,NA,NA,1910-10-30,Heiden,Switzerland
1901,Peace,The Nobel Peace Prize 1901,NA,1/2,463,Individual,Frédéric Passy,1822-05-20,Paris,France,Male,NA,NA,NA,1912-06-12,Paris,France
1901,Physics,The Nobel Prize in Physics 1901,"""in recognition of the extraordinary services he has rendered by the discovery of the remarkable rays subsequently named after him""",1/1,1,Individual,Wilhelm Conrad Röntgen,1845-03-27,Lennep (Remscheid),Prussia (Germany),Male,Munich University,Munich,Germany,1923-02-10,Munich,Germany
1902,Chemistry,The Nobel Prize in Chemistry 1902,"""in recognition of the extraordinary services he has rendered by his work on sugar and purine syntheses""",1/1,161,Individual,Hermann Emil Fischer,1852-10-09,Euskirchen,Prussia (Germany),Male,Berlin University,Berlin,Germany,1919-07-15,Berlin,Germany
1902,Literature,The Nobel Prize in Literature 1902,"""the greatest living master of the art of historical writing, with special reference to his monumental work, <I>A history of Rome</I>""",1/1,571,Individual,Christian Matthias Theodor Mommsen,1817-11-30,Garding,Schleswig (Germany),Male,NA,NA,NA,1903-11-01,Charlottenburg,Germany
1902,Medicine,The Nobel Prize in Physiology or Medicine 1902,"""for his work on malaria, by which he has shown how it enters the organism and thereby has laid the foundation for successful research on this disease and methods of combating it""",1/1,294,Individual,Ronald Ross,1857-05-13,Almora,India,Male,University College,Liverpool,United Kingdom,1932-09-16,Putney Heath,United Kingdom
1902,Peace,The Nobel Peace Prize 1902,NA,1/2,464,Individual,Élie Ducommun,1833-02-19,Geneva,Switzerland,Male,NA,NA,NA,1906-12-07,Bern,Switzerland
1902,Peace,The Nobel Peace Prize 1902,NA,1/2,465,Individual,Charles Albert Gobat,1843-05-21,Tramelan,Switzerland,Male,NA,NA,NA,1914-03-16,Bern,Switzerland
1902,Physics,The Nobel Prize in Physics 1902,"""in recognition of the extraordinary service they rendered by their researches into the influence of magnetism upon radiation phenomena""",1/2,2,Individual,Hendrik Antoon Lorentz,1853-07-18,Arnhem,Netherlands,Male,Leiden University,Leiden,Netherlands,1928-02-04,NA,Netherlands'''
            }
        ]
    }, {
        'source': 'tidytuesday',
        'name': 'Space launches',
        'description': 'Taken from Economist GitHub (https://github.com/rfordatascience/tidytuesday/tree/main/data/2018/2018-08-21). These are the data behind the "space launches" article, The space race is dominated by new contenders. Principal data came from the Jonathan McDowell\'s JSR Launch Vehicle Database.',
        'tables': [
            {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2019/2019-01-15/agencies.csv',
                'sample': '''agency,count,ucode,state_code,type,class,tstart,tstop,short_name,name,location,longitude,latitude,error,parent,short_english_name,english_name,unicode_name,agency_type
RVSN,1528,RVSN,SU,O/LA,D,1960,1991 Dec,RVSN,Rakentiye Voiska Strategicheskogo Naznacheniye,Mosvka?,-,-,-,-,-,Strategic Rocket Forces,Ракетные войска стратегического назначения,state
UNKS,904,GUKOS,SU,O/LA,D,1986 Apr 24,1991,UNKS,Upravleniye Nachalnika Kosmicheskikh Sredstv,Moskva,-,-,-,MO,-,-,Управление начальника космических средств МО СССР,state
NASA,469,NASA,US,O/LA/LV/PL/S,C,1958 Oct  1,-,NASA,National Aeronautics and Space Administration,"Washington, D.C.",-,-,-,-,-,-,National Aeronautics and Space Administration,state
USAF,388,USAF,US,O/LA/S,D,1947 Sep 18,-,USAF,United States Air Force,"Washington, DC-Pentagon",-,-,-,-,-,-,United States Air Force,state
AE,258,AE,F,O/LA,B,1980 Mar 26,*,Arianespace,"Arianespace, Inc.","Paris-Evry, France",-,-,-,-,Arianespace,-,"Arianespace, Inc.",private
AFSC,247,AFSC,US,LA,D,1961 Apr  1,1992 Jul  1,AFSC,"US Air Force Systems Command, Los Angeles AFS","El Segundo, California",-,-,-,USAF,-,-,"US Air Force Systems Command, Los Angeles AFS",state
VKSR,200,GUKOS,RU,O/LA,D,1997 Jul,2001 Jun  1,VKS RVSN,"Voenno-Kosmicheskiye Sili (Military Space Forces), RVSN","Mosvka-Solnechnogorsk, Rossiya",-,-,-,RVSN,-,Russian Military Space Forces,Военно-космические силы РВСН,state
CALT,181,CALT,CN,LA/LV/PL/E,C,1957 Nov 11,-,CALT,Zhongguo yunzaihuojian jishu yanjiu yuan,Beijing-Nanyuan,-,-,-,CASC,CALT,Chinese Academy of Launch Vehicle Technology (CASC 1st Acad),中国运载火箭技术研究院,state
FKA,128,MOM,RU,O/LA,C,2004,2016 Jan  1,Roskosmos,Federal'noe kosmicheskoe agentstvo Rossii (Roskosmos),Moskva,-,-,-,-,-,Roskosmos,Федеральное космическое агентство (Роскосмос),state
SAST,105,SBA,CN,O/LA/LV/PL,B,1993,-,SAST,Shanghai hangtian jishu yanjiuyuan,Shanghai-Minghan,-,-,-,CASC,-,Shanghai Academy of Space Technology (CASC 8th Acad),上海航天技术研究院,state
ILSK,97,ILSK,RU,LA,B,1995,-,ILS-K,"International Launch Services, Khrunichev",Moskva,-,-,-,KHRU,-,-,"International Launch Services, Khrunichev",private
KVR,78,GUKOS,RU,O/LA,D,2001 Jun  1,2011 Dec  1,KVR,Kosmichesikiye voyska Rossii,Moskva-Solnechnogorsk,-,-,-,-,-,Russian Space Forces,Космические войска России,state
ULAL,70,ULAL,US,LA,B,2006 Dec,-,ULA/LMA,United Launch Alliance/Lockheed Martin Astronautics,"Denver-Centennial, Colorado",-,-,-,LM,-,-,United Launch Alliance/Lockheed Martin Astronautics,private
KHRU,67,KHRU,RU,O/LA/LV/PL/S,B,1994,1998,Khrunichev,"GKNPTs im. M.V. Khrunichev, Zavod Khrunichev",Moskva-Fili,-,-,-,-,-,Khrunichev State Research and Production Center,ГКНПЦ им. М.В.Хруничева,state
SPX,65,SPX,US,O/LA/LV/PL/S,B,2007 Aug,-,SpaceX,SpaceX,"Hawthorne, California",-,-,-,-,-,-,SpaceX,startup'''
            }, {
                "format": 'csv',
                "url": 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/refs/heads/main/data/2019/2019-01-15/launches.csv',
                'sample': '''tag,JD,launch_date,launch_year,type,variant,mission,agency,state_code,category,agency_type
1967-065,2439671.38,1967-06-29,1967,Thor Burner 2,,Secor Type II S/N 10,US,US,O,state
1967-080,2439725.7,1967-08-23,1967,Thor Burner 2,,DAPP 3419,US,US,O,state
1967-096,2439774.83,1967-10-11,1967,Thor Burner 2,,DAPP 4417,US,US,O,state
1968-042,2439999.69,1968-05-23,1968,Thor Burner 2,,DAPP 5420,US,US,O,state
1968-092,2440152.69,1968-10-23,1968,Thor Burner 2,,DAPP 6422,US,US,O,state
1969-062,2440425.69,1969-07-23,1969,Thor Burner 2,,DAPP 7421,US,US,O,state
1970-012,2440628.86,1970-02-11,1970,Thor Burner 2,,DAPP Block 5A F-1,US,US,O,state
1970-070,2440832.86,1970-09-03,1970,Thor Burner 2,,DAPP Block 5A F-2,US,US,O,state
1971-012,2440999.66,1971-02-17,1971,Thor Burner 2,,DAPP Block 5A F-3,US,US,O,state
1971-054,2441111.08,1971-06-08,1971,Thor Burner 2,,P70-1,US,US,O,state
1971-087,2441238.83,1971-10-14,1971,Thor Burner 2A,,DMSP Block 5B F-1 (SV-2),US,US,O,state
1972-018,2441400.87,1972-03-24,1972,Thor Burner 2A,,DMSP Block 5B F-2 (SV-1),US,US,O,state
1972-089,2441630.64,1972-11-09,1972,Thor Burner 2A,,DMSP Block 5B F-3,US,US,O,state
1973-054,2441911.7,1973-08-17,1973,Thor Burner 2A,,DMSP Block 5B F-4,US,US,O,state
1974-015,2442122.83,1974-03-16,1974,Thor Burner 2A,,DMSP Block 5B F-5,US,US,O,state
1974-063,2442268.64,1974-08-09,1974,Thor Burner 2A,,DMSP Block 5C F-1,US,US,O,state'''
            }
        ]
    }
]


