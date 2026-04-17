-- Test Database Initialization Script for Data Formulator
-- Creates sample tables and data for testing the MySQL data loader.
-- Database testdb is created by MYSQL_DATABASE env in Dockerfile.

USE testdb;

-- Products table
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    price DECIMAL(10, 2),
    stock_quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Customers table
CREATE TABLE customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE,
    city VARCHAR(100),
    country VARCHAR(50),
    signup_date DATE DEFAULT (CURRENT_DATE)
);

-- Orders table
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(12, 2),
    status VARCHAR(20) DEFAULT 'pending',
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Order items table
CREATE TABLE order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    product_id INT,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- App settings table (mirrors public.app_settings in Postgres)
CREATE TABLE app_settings (
    `key` VARCHAR(50) PRIMARY KEY,
    value TEXT,
    description VARCHAR(200)
);

-- Insert sample products
INSERT INTO products (name, category, price, stock_quantity) VALUES
    ('Laptop Pro 15', 'Electronics', 1299.99, 50),
    ('Wireless Mouse', 'Electronics', 29.99, 200),
    ('USB-C Hub', 'Electronics', 49.99, 150),
    ('Mechanical Keyboard', 'Electronics', 149.99, 75),
    ('Monitor 27"', 'Electronics', 399.99, 30),
    ('Office Chair', 'Furniture', 299.99, 40),
    ('Standing Desk', 'Furniture', 599.99, 25),
    ('Desk Lamp', 'Furniture', 39.99, 100),
    ('Notebook Pack', 'Supplies', 12.99, 500),
    ('Pen Set', 'Supplies', 8.99, 300),
    ('Whiteboard', 'Supplies', 89.99, 45),
    ('Headphones', 'Electronics', 199.99, 60);

-- Insert sample customers
INSERT INTO customers (first_name, last_name, email, city, country) VALUES
    ('John', 'Doe', 'john.doe@email.com', 'New York', 'USA'),
    ('Jane', 'Smith', 'jane.smith@email.com', 'Los Angeles', 'USA'),
    ('Bob', 'Johnson', 'bob.j@email.com', 'Chicago', 'USA'),
    ('Alice', 'Williams', 'alice.w@email.com', 'London', 'UK'),
    ('Charlie', 'Brown', 'charlie.b@email.com', 'Paris', 'France'),
    ('Diana', 'Miller', 'diana.m@email.com', 'Berlin', 'Germany'),
    ('Edward', 'Davis', 'edward.d@email.com', 'Tokyo', 'Japan'),
    ('Fiona', 'Garcia', 'fiona.g@email.com', 'Sydney', 'Australia'),
    ('George', 'Martinez', 'george.m@email.com', 'Toronto', 'Canada'),
    ('Helen', 'Anderson', 'helen.a@email.com', 'Seattle', 'USA');

-- Insert sample orders
INSERT INTO orders (customer_id, order_date, total_amount, status) VALUES
    (1, '2024-01-15 10:30:00', 1349.98, 'completed'),
    (2, '2024-01-16 14:20:00', 449.98, 'completed'),
    (3, '2024-01-17 09:15:00', 299.99, 'completed'),
    (1, '2024-01-20 16:45:00', 79.98, 'completed'),
    (4, '2024-01-22 11:00:00', 1699.98, 'completed'),
    (5, '2024-01-25 13:30:00', 639.98, 'shipped'),
    (6, '2024-02-01 10:00:00', 199.99, 'shipped'),
    (7, '2024-02-05 15:20:00', 549.98, 'processing'),
    (8, '2024-02-10 09:45:00', 89.97, 'pending'),
    (9, '2024-02-12 14:00:00', 1299.99, 'pending');

-- Insert sample order items
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 1, 1299.99),
    (1, 2, 1, 29.99),
    (1, 3, 1, 49.99),
    (2, 5, 1, 399.99),
    (2, 3, 1, 49.99),
    (3, 6, 1, 299.99),
    (4, 2, 2, 29.99),
    (4, 10, 2, 8.99),
    (5, 1, 1, 1299.99),
    (5, 5, 1, 399.99),
    (6, 7, 1, 599.99),
    (6, 8, 1, 39.99),
    (7, 12, 1, 199.99),
    (8, 4, 1, 149.99),
    (8, 5, 1, 399.99),
    (9, 9, 3, 12.99),
    (9, 10, 5, 8.99),
    (9, 11, 1, 89.99),
    (10, 1, 1, 1299.99);

-- App settings
INSERT INTO app_settings (`key`, value, description) VALUES
    ('app_name', 'Data Formulator', 'Application name'),
    ('version', '0.5.0', 'Current version'),
    ('max_rows', '1000000', 'Maximum rows to load'),
    ('theme', 'light', 'Default UI theme');
