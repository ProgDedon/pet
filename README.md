# OnlinePet Store

A dynamic online pet store built with Express, EJS, and MySQL.

## Features
- Browse pets by category and search by keywords
- Pet details page with add-to-cart behavior
- Persistent shopping cart in session
- Simulated checkout with order creation
- Admin area with pet management and order review
- Responsive UI with Bootstrap

## Setup
1. Copy `.env.example` to `.env` and update your MySQL credentials.
2. Create the database and tables:
   - `mysql -u root -p < sql/schema.sql`
3. Install dependencies:
   - `npm install`
4. Start the server:
   - `npm run dev`

## Admin login
- Email: `admin@onlinepet.local`
- Password: `password`

To generate the password hash for the admin account, run:
```bash
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('password', 10));"
```
Then update the INSERT in `sql/schema.sql` with the generated hash.

## Notes
- Images are loaded from remote URLs in the seed data.
- Use a real MySQL instance and update `.env` before running.
