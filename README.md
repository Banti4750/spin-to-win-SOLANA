# Spin to Win

## Project Overview

Spin to Win is a decentralized application (dApp) built on the Solana blockchain that allows users to participate in a lottery-like game. Users can buy tickets, spin a wheel, and claim rewards based on the outcome.

## Features

- **Decentralized Lottery**: A transparent and fair lottery system powered by Solana smart contracts.
- **Ticket Purchase**: Users can purchase tickets to participate in the game.
- **Spin Wheel**: Interactive spinning mechanism to determine rewards.
- **Reward Claiming**: Users can claim their winnings directly to their Solana wallet.

## Technologies Used

### Frontend (Client)

- **React**: A JavaScript library for building user interfaces.
- **Vite**: A fast build tool for modern web projects.
- **Tailwind CSS**: A utility-first CSS framework for rapid UI development.

### Backend (Server)

- **Node.js**: A JavaScript runtime for server-side development.
- **Express.js**: A web application framework for Node.js.

### Blockchain (Contract)

- **Solana**: A high-performance blockchain platform.
- **Anchor Framework**: A framework for Solana smart contract development.
- **Rust**: The programming language used for writing Solana smart contracts.

## Setup Instructions

To set up the project locally, follow these steps:

### Prerequisites

- Node.js (v18 or higher)
- npm or Yarn
- Rust and Cargo
- Solana CLI
- Anchor CLI

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/spinToWin.git
cd spinToWin
```

### 2. Install Dependencies

#### Contract

Navigate to the `contract` directory and install Anchor dependencies:

```bash
cd contract
yarn install
```

#### Client

Navigate to the `client` directory and install Node.js dependencies:

```bash
cd ../client
npm install
# or yarn install
```

#### Server

Navigate to the `server` directory and install Node.js dependencies:

```bash
cd ../server
npm install
# or yarn install
```

### 3. Build and Deploy the Solana Program

First, ensure your Solana CLI is configured to a local validator or devnet.

```bash
solana config set --url localhost
# or solana config set --url devnet
```

Start a local Solana validator (if not already running):

```bash
solana-test-validator
```

In the `contract` directory, build and deploy your program:

```bash
cd ../contract
anchor build
anchor deploy
```

Make sure to update the program ID in `client/src/utils/constants.js` (or similar file) with the deployed program ID.

## Running the Project

### 1. Start the Server

In the `server` directory:

```bash
cd server
npm start
```

### 2. Start the Client

In the `client` directory:

```bash
cd client
npm run dev
```

The client application should now be running at `http://localhost:5173` (or another port specified by Vite).

## Testing

To run the contract tests, navigate to the `contract` directory and execute:

```bash
cd contract
anchor test
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue.

## License

This project is licensed under the MIT License.