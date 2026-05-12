// Test Database Initialization Script for Data Formulator
// Creates sample collections and data for testing the MongoDB data loader.
// Runs inside the testdb database (set by MONGO_INITDB_DATABASE).

// Create a test user with readWrite on testdb
db.createUser({
  user: "testuser",
  pwd: "testpass",
  roles: [{ role: "readWrite", db: "testdb" }],
});

// Products collection (12 documents — matches MySQL/Postgres seed data)
// Includes nested objects (specs) and arrays (tags) to test flattening.
db.products.insertMany([
  { id: 1,  name: "Laptop Pro 15",       category: "Electronics", price: 1299.99, stock_quantity: 50,  created_at: new Date("2024-01-01T10:00:00Z"), specs: { weight_kg: 1.8, screen: "15.6 inch", ram_gb: 16 }, tags: ["laptop", "portable", "pro"] },
  { id: 2,  name: "Wireless Mouse",      category: "Electronics", price: 29.99,   stock_quantity: 200, created_at: new Date("2024-01-02T10:00:00Z"), specs: { weight_kg: 0.1, connectivity: "bluetooth" },       tags: ["mouse", "wireless"] },
  { id: 3,  name: "USB-C Hub",           category: "Electronics", price: 49.99,   stock_quantity: 150, created_at: new Date("2024-01-03T10:00:00Z"), specs: { weight_kg: 0.15, ports: 7 },                       tags: ["hub", "usb-c"] },
  { id: 4,  name: "Mechanical Keyboard", category: "Electronics", price: 149.99,  stock_quantity: 75,  created_at: new Date("2024-01-04T10:00:00Z"), specs: { weight_kg: 0.9, switch_type: "cherry-mx" },         tags: ["keyboard", "mechanical"] },
  { id: 5,  name: "Monitor 27\"",        category: "Electronics", price: 399.99,  stock_quantity: 30,  created_at: new Date("2024-01-05T10:00:00Z"), specs: { weight_kg: 5.2, resolution: "2560x1440" },          tags: ["monitor", "display"] },
  { id: 6,  name: "Office Chair",        category: "Furniture",   price: 299.99,  stock_quantity: 40,  created_at: new Date("2024-01-06T10:00:00Z"), specs: { weight_kg: 12, material: "mesh" },                  tags: ["chair", "ergonomic"] },
  { id: 7,  name: "Standing Desk",       category: "Furniture",   price: 599.99,  stock_quantity: 25,  created_at: new Date("2024-01-07T10:00:00Z"), specs: { weight_kg: 30, adjustable: true },                  tags: ["desk", "standing"] },
  { id: 8,  name: "Desk Lamp",           category: "Furniture",   price: 39.99,   stock_quantity: 100, created_at: new Date("2024-01-08T10:00:00Z"), specs: { weight_kg: 0.5, lumens: 800 },                      tags: ["lamp", "led"] },
  { id: 9,  name: "Notebook Pack",       category: "Supplies",    price: 12.99,   stock_quantity: 500, created_at: new Date("2024-01-09T10:00:00Z"), specs: { weight_kg: 0.3, pages: 200 },                       tags: ["notebook", "stationery"] },
  { id: 10, name: "Pen Set",             category: "Supplies",    price: 8.99,    stock_quantity: 300, created_at: new Date("2024-01-10T10:00:00Z"), specs: { weight_kg: 0.05, count: 10 },                       tags: ["pen", "stationery"] },
  { id: 11, name: "Whiteboard",          category: "Supplies",    price: 89.99,   stock_quantity: 45,  created_at: new Date("2024-01-11T10:00:00Z"), specs: { weight_kg: 3, size: "90x120cm" },                   tags: ["whiteboard", "office"] },
  { id: 12, name: "Headphones",          category: "Electronics", price: 199.99,  stock_quantity: 60,  created_at: new Date("2024-01-12T10:00:00Z"), specs: { weight_kg: 0.25, noise_cancelling: true },          tags: ["headphones", "audio"] },
]);

// Customers collection
db.customers.insertMany([
  { id: 1,  first_name: "John",    last_name: "Doe",       email: "john.doe@email.com",    city: "New York",    country: "USA",       signup_date: new Date("2024-01-15") },
  { id: 2,  first_name: "Jane",    last_name: "Smith",     email: "jane.smith@email.com",  city: "Los Angeles", country: "USA",       signup_date: new Date("2024-01-16") },
  { id: 3,  first_name: "Bob",     last_name: "Johnson",   email: "bob.j@email.com",       city: "Chicago",     country: "USA",       signup_date: new Date("2024-01-17") },
  { id: 4,  first_name: "Alice",   last_name: "Williams",  email: "alice.w@email.com",     city: "London",      country: "UK",        signup_date: new Date("2024-01-22") },
  { id: 5,  first_name: "Charlie", last_name: "Brown",     email: "charlie.b@email.com",   city: "Paris",       country: "France",    signup_date: new Date("2024-01-25") },
  { id: 6,  first_name: "Diana",   last_name: "Miller",    email: "diana.m@email.com",     city: "Berlin",      country: "Germany",   signup_date: new Date("2024-02-01") },
  { id: 7,  first_name: "Edward",  last_name: "Davis",     email: "edward.d@email.com",    city: "Tokyo",       country: "Japan",     signup_date: new Date("2024-02-05") },
  { id: 8,  first_name: "Fiona",   last_name: "Garcia",    email: "fiona.g@email.com",     city: "Sydney",      country: "Australia", signup_date: new Date("2024-02-10") },
  { id: 9,  first_name: "George",  last_name: "Martinez",  email: "george.m@email.com",    city: "Toronto",     country: "Canada",    signup_date: new Date("2024-02-12") },
  { id: 10, first_name: "Helen",   last_name: "Anderson",  email: "helen.a@email.com",     city: "Seattle",     country: "USA",       signup_date: new Date("2024-02-15") },
]);

// Orders collection
db.orders.insertMany([
  { id: 1,  customer_id: 1, order_date: new Date("2024-01-15T10:30:00Z"), total_amount: 1349.98, status: "completed" },
  { id: 2,  customer_id: 2, order_date: new Date("2024-01-16T14:20:00Z"), total_amount: 449.98,  status: "completed" },
  { id: 3,  customer_id: 3, order_date: new Date("2024-01-17T09:15:00Z"), total_amount: 299.99,  status: "completed" },
  { id: 4,  customer_id: 1, order_date: new Date("2024-01-20T16:45:00Z"), total_amount: 79.98,   status: "completed" },
  { id: 5,  customer_id: 4, order_date: new Date("2024-01-22T11:00:00Z"), total_amount: 1699.98, status: "completed" },
  { id: 6,  customer_id: 5, order_date: new Date("2024-01-25T13:30:00Z"), total_amount: 639.98,  status: "shipped" },
  { id: 7,  customer_id: 6, order_date: new Date("2024-02-01T10:00:00Z"), total_amount: 199.99,  status: "shipped" },
  { id: 8,  customer_id: 7, order_date: new Date("2024-02-05T15:20:00Z"), total_amount: 549.98,  status: "processing" },
  { id: 9,  customer_id: 8, order_date: new Date("2024-02-10T09:45:00Z"), total_amount: 89.97,   status: "pending" },
  { id: 10, customer_id: 9, order_date: new Date("2024-02-12T14:00:00Z"), total_amount: 1299.99, status: "pending" },
]);

// App settings collection
db.app_settings.insertMany([
  { key: "app_name", value: "Data Formulator", description: "Application name" },
  { key: "version",  value: "0.5.0",           description: "Current version" },
  { key: "max_rows", value: "1000000",         description: "Maximum rows to load" },
  { key: "theme",    value: "light",           description: "Default UI theme" },
]);

print("Test database initialized: products(12), customers(10), orders(10), app_settings(4)");
