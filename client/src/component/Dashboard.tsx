import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Program, AnchorProvider, web3, BN, setProvider } from '@coral-xyz/anchor';

// Your actual IDL and Program ID
const PROGRAM_ID = new PublicKey("6fqRppPtwd8E51BLjgtSAi4vfM4DHN3MbtetETU6De1p");

// IDL (simplified structure based on your types)
const IDL = {
    "address": "3z5DJ8k16cB8oAtbS45ye4PdtFQZBrFjNKhqks2AAxxr",
    "metadata": {
        "name": "companyPool",
        "version": "0.1.0",
        "spec": "0.1.0"
    },
    "instructions": [
        {
            "name": "initializeCompanyPool",
            "accounts": [
                { "name": "companyPool", "isMut": true, "isSigner": false },
                { "name": "poolVault", "isMut": true, "isSigner": false },
                { "name": "authority", "isMut": true, "isSigner": true },
                { "name": "systemProgram", "isMut": false, "isSigner": false }
            ],
            "args": [
                { "name": "ticketPrice", "type": "u64" },
                { "name": "companyName", "type": "string" },
                { "name": "companyImage", "type": "string" },
                { "name": "items", "type": { "vec": "PoolItemInput" } }
            ]
        },
        {
            "name": "buyTicket",
            "accounts": [
                { "name": "companyPool", "isMut": true, "isSigner": false },
                { "name": "userTicket", "isMut": true, "isSigner": false },
                { "name": "buyer", "isMut": true, "isSigner": true },
                { "name": "poolVault", "isMut": true, "isSigner": false },
                { "name": "systemProgram", "isMut": false, "isSigner": false }
            ],
            "args": []
        },
        {
            "name": "recordSpinResult",
            "accounts": [
                { "name": "companyPool", "isMut": true, "isSigner": false },
                { "name": "userTicket", "isMut": true, "isSigner": false },
                { "name": "spinner", "isMut": true, "isSigner": true },
                { "name": "poolVault", "isMut": true, "isSigner": false },
                { "name": "systemProgram", "isMut": false, "isSigner": false }
            ],
            "args": []
        },
        {
            "name": "claimReward",
            "accounts": [
                { "name": "companyPool", "isMut": true, "isSigner": false },
                { "name": "userTicket", "isMut": true, "isSigner": false },
                { "name": "spinner", "isMut": true, "isSigner": true },
                { "name": "poolVault", "isMut": true, "isSigner": false },
                { "name": "systemProgram", "isMut": false, "isSigner": false }
            ],
            "args": []
        }
    ]
};

// SpinWheel Component
function SpinWheel({ items, isSpinning, onSpinComplete, winner }) {
    const [rotation, setRotation] = useState(0);
    const [currentRotation, setCurrentRotation] = useState(0);

    const segmentAngle = 360 / items.length;

    useEffect(() => {
        if (isSpinning && winner !== null) {
            const winnerIndex = items.findIndex(item => item.name === winner);
            const targetAngle = 360 - (winnerIndex * segmentAngle) - (segmentAngle / 2);
            const fullSpins = 5;
            const finalRotation = currentRotation + (fullSpins * 360) + targetAngle;
            setRotation(finalRotation);
            setCurrentRotation(finalRotation % 360);

            setTimeout(() => {
                onSpinComplete();
            }, 4000);
        }
    }, [isSpinning, winner, items, segmentAngle, currentRotation, onSpinComplete]);

    return (
        <div className="relative w-80 h-80 mx-auto">
            <div className="relative w-full h-full">
                <svg
                    width="320"
                    height="320"
                    className={`transform transition-transform duration-[4000ms] ease-out ${isSpinning ? 'animate-pulse' : ''}`}
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    {items.map((item, index) => {
                        const startAngle = (index * segmentAngle - 90) * (Math.PI / 180);
                        const endAngle = ((index + 1) * segmentAngle - 90) * (Math.PI / 180);
                        const largeArcFlag = segmentAngle > 180 ? 1 : 0;

                        const x1 = 160 + 140 * Math.cos(startAngle);
                        const y1 = 160 + 140 * Math.sin(startAngle);
                        const x2 = 160 + 140 * Math.cos(endAngle);
                        const y2 = 160 + 140 * Math.sin(endAngle);

                        const textAngle = (startAngle + endAngle) / 2;
                        const textX = 160 + 100 * Math.cos(textAngle);
                        const textY = 160 + 100 * Math.sin(textAngle);

                        return (
                            <g key={index}>
                                <defs>
                                    <linearGradient id={`gradient-${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor={`hsl(${(index * 360) / items.length}, 70%, 60%)`} />
                                        <stop offset="100%" stopColor={`hsl(${(index * 360) / items.length}, 70%, 40%)`} />
                                    </linearGradient>
                                </defs>
                                <path
                                    d={`M 160 160 L ${x1} ${y1} A 140 140 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
                                    fill={`url(#gradient-${index})`}
                                    stroke="white"
                                    strokeWidth="2"
                                    className="hover:brightness-110 transition-all duration-200"
                                />
                                <text
                                    x={textX}
                                    y={textY}
                                    fill="white"
                                    fontSize="12"
                                    fontWeight="bold"
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    transform={`rotate(${(textAngle * 180) / Math.PI}, ${textX}, ${textY})`}
                                    className="pointer-events-none select-none drop-shadow-lg"
                                >
                                    {item.name}
                                </text>
                                <text
                                    x={textX}
                                    y={textY + 15}
                                    fill="white"
                                    fontSize="10"
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    transform={`rotate(${(textAngle * 180) / Math.PI}, ${textX}, ${textY + 15})`}
                                    className="pointer-events-none select-none drop-shadow-lg opacity-90"
                                >
                                    {(item.price / LAMPORTS_PER_SOL).toFixed(2)} SOL
                                </text>
                            </g>
                        );
                    })}
                </svg>

                {/* Center circle */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full border-4 border-white shadow-xl flex items-center justify-center">
                    <div className="text-white font-bold text-sm">SPIN</div>
                </div>

                {/* Pointer */}
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1 z-10">
                    <div className="w-0 h-0 border-l-4 border-r-4 border-b-8 border-l-transparent border-r-transparent border-b-red-500 drop-shadow-lg"></div>
                </div>
            </div>
        </div>
    );
}

// Main Component
export default function CompanyPoolClient() {
    const wallet = useWallet();
    const { connection } = useConnection();
    const [program, setProgram] = useState(null);

    // State management
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [txSignature, setTxSignature] = useState('');

    // Pool creation state
    const [poolForm, setPoolForm] = useState({
        companyName: 'SpinCorp',
        companyImage: 'https://via.placeholder.com/300x200/6366F1/FFFFFF?text=SpinCorp',
        ticketPrice: '0.1',
        items: [
            { name: 'Bronze Prize', price: '0.5', image: 'https://via.placeholder.com/100/CD7F32/FFFFFF?text=Bronze', description: 'Basic reward for lucky spinners' },
            { name: 'Silver Prize', price: '1.0', image: 'https://via.placeholder.com/100/C0C0C0/000000?text=Silver', description: 'Great prize with good value' },
            { name: 'Gold Prize', price: '2.0', image: 'https://via.placeholder.com/100/FFD700/000000?text=Gold', description: 'Premium prize for winners' },
            { name: 'Diamond Prize', price: '5.0', image: 'https://via.placeholder.com/100/B9F2FF/000000?text=Diamond', description: 'Ultimate jackpot prize' }
        ]
    });

    // Pool state
    const [companyPool, setCompanyPool] = useState(null);
    const [poolPda, setPoolPda] = useState(null);
    const [vaultPda, setVaultPda] = useState(null);
    const [userTicket, setUserTicket] = useState(null);
    const [ticketPda, setTicketPda] = useState(null);

    // Spin state
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinResult, setSpinResult] = useState(null);
    const [canClaim, setCanClaim] = useState(false);

    // Initialize program
    useEffect(() => {
        if (wallet.publicKey && connection) {
            try {
                const provider = new AnchorProvider(connection, wallet, {
                    commitment: 'confirmed',
                });
                setProvider(provider);

                const program = new Program(IDL, PROGRAM_ID, provider);
                setProgram(program);

                setStatus('Wallet connected successfully!');
                setError('');
            } catch (err) {
                console.error('Program initialization error:', err);
                setError('Failed to initialize program: ' + err.message);
            }
        }
    }, [wallet.publicKey, connection, wallet]);

    // Derive PDAs
    const derivePDAs = useCallback(async (companyName) => {
        try {
            const [poolPda] = await PublicKey.findProgramAddressSync(
                [Buffer.from("company_pool"), Buffer.from(companyName)],
                PROGRAM_ID
            );

            const [vaultPda] = await PublicKey.findProgramAddressSync(
                [Buffer.from("pool_vault"), Buffer.from(companyName)],
                PROGRAM_ID
            );

            setPoolPda(poolPda);
            setVaultPda(vaultPda);

            return { poolPda, vaultPda };
        } catch (err) {
            throw new Error('Failed to derive PDAs: ' + err.message);
        }
    }, []);

    // Step 1: Initialize Company Pool
    const initializePool = async () => {
        if (!wallet.publicKey || !program) {
            setError('Please connect your wallet first');
            return;
        }

        setLoading(true);
        setError('');
        setStatus('Initializing company pool...');

        try {
            const { poolPda, vaultPda } = await derivePDAs(poolForm.companyName);

            const items = poolForm.items.map(item => ({
                image: item.image,
                price: new BN(parseFloat(item.price) * LAMPORTS_PER_SOL),
                name: item.name,
                description: item.description
            }));

            console.log('Initializing pool with:', {
                ticketPrice: parseFloat(poolForm.ticketPrice) * LAMPORTS_PER_SOL,
                companyName: poolForm.companyName,
                items: items.length
            });

            const tx = await program.methods
                .initializeCompanyPool(
                    new BN(parseFloat(poolForm.ticketPrice) * LAMPORTS_PER_SOL),
                    poolForm.companyName,
                    poolForm.companyImage,
                    items
                )
                .accounts({
                    companyPool: poolPda,
                    poolVault: vaultPda,
                    authority: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            await connection.confirmTransaction(tx, 'confirmed');
            setTxSignature(tx);

            // Fetch the created pool data
            const poolAccount = await program.account.companyPool.fetch(poolPda);
            setCompanyPool(poolAccount);

            setStatus('Pool initialized successfully! 🎉');
            setStep(2);

        } catch (err) {
            console.error('Pool initialization error:', err);
            setError('Failed to initialize pool: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    // Step 2: Buy Ticket
    const buyTicket = async () => {
        if (!wallet.publicKey || !companyPool || !program) {
            setError('Pool not initialized or wallet not connected');
            return;
        }

        setLoading(true);
        setError('');
        setStatus('Buying ticket...');

        try {
            const ticketId = companyPool.totalTicketsSold.toNumber();
            const ticketIdBuffer = Buffer.alloc(8);
            ticketIdBuffer.writeBigUInt64LE(BigInt(ticketId), 0);

            const [ticketPda] = await PublicKey.findProgramAddressSync(
                [
                    Buffer.from("user_ticket"),
                    wallet.publicKey.toBuffer(),
                    poolPda.toBuffer(),
                    ticketIdBuffer
                ],
                PROGRAM_ID
            );

            console.log('Buying ticket with PDA:', ticketPda.toString());

            const tx = await program.methods
                .buyTicket()
                .accounts({
                    companyPool: poolPda,
                    userTicket: ticketPda,
                    buyer: wallet.publicKey,
                    poolVault: vaultPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            await connection.confirmTransaction(tx, 'confirmed');
            setTxSignature(tx);

            // Fetch the created ticket
            const ticketAccount = await program.account.userTicket.fetch(ticketPda);
            setUserTicket(ticketAccount);
            setTicketPda(ticketPda);

            // Refresh pool data
            const updatedPool = await program.account.companyPool.fetch(poolPda);
            setCompanyPool(updatedPool);

            setStatus('Ticket purchased successfully! 🎫');
            setStep(3);

        } catch (err) {
            console.error('Ticket purchase error:', err);
            setError('Failed to buy ticket: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    // Step 3: Spin the Wheel
    const spinWheel = async () => {
        if (!userTicket || userTicket.used || !program) {
            setError('No valid ticket available or ticket already used');
            return;
        }

        setLoading(true);
        setError('');
        setStatus('Spinning the wheel...');
        setIsSpinning(true);

        try {
            console.log('Recording spin result...');

            const tx = await program.methods
                .recordSpinResult()
                .accounts({
                    companyPool: poolPda,
                    userTicket: ticketPda,
                    spinner: wallet.publicKey,
                    poolVault: vaultPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            await connection.confirmTransaction(tx, 'confirmed');
            setTxSignature(tx);

            // Fetch updated ticket to see what was won
            const updatedTicket = await program.account.userTicket.fetch(ticketPda);
            setUserTicket(updatedTicket);

            if (updatedTicket.wonItem) {
                setSpinResult(updatedTicket.wonItem.name);
                setCanClaim(true);

                // Simulate wheel spinning animation
                setTimeout(() => {
                    setStatus(`Congratulations! You won ${updatedTicket.wonItem.name}! 🎉`);
                    setStep(4);
                    setLoading(false);
                }, 4000);
            } else {
                setStatus('Spin completed, but no item won this time.');
                setLoading(false);
                setIsSpinning(false);
            }

        } catch (err) {
            console.error('Spin error:', err);
            setError('Failed to spin: ' + (err.message || err.toString()));
            setLoading(false);
            setIsSpinning(false);
        }
    };

    // Step 4: Claim Reward
    const claimReward = async () => {
        if (!canClaim || !userTicket?.wonItem || !program) {
            setError('No reward to claim');
            return;
        }

        setLoading(true);
        setError('');
        setStatus('Claiming reward...');

        try {
            console.log('Claiming reward...');

            const tx = await program.methods
                .claimReward()
                .accounts({
                    companyPool: poolPda,
                    userTicket: ticketPda,
                    spinner: wallet.publicKey,
                    poolVault: vaultPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            await connection.confirmTransaction(tx, 'confirmed');
            setTxSignature(tx);

            // Fetch updated ticket
            const updatedTicket = await program.account.userTicket.fetch(ticketPda);
            setUserTicket(updatedTicket);

            setCanClaim(false);
            setStatus(`Reward claimed! You received ${updatedTicket.wonItem.price / LAMPORTS_PER_SOL} SOL! 💰`);
            setStep(5);

        } catch (err) {
            console.error('Claim error:', err);
            setError('Failed to claim reward: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    const resetGame = () => {
        setStep(1);
        setCompanyPool(null);
        setUserTicket(null);
        setSpinResult(null);
        setCanClaim(false);
        setIsSpinning(false);
        setError('');
        setStatus('');
        setTxSignature('');
    };

    const onSpinComplete = () => {
        setIsSpinning(false);
    };

    const addItem = () => {
        if (poolForm.items.length < 10) {
            setPoolForm({
                ...poolForm,
                items: [...poolForm.items, {
                    name: `Prize ${poolForm.items.length + 1}`,
                    price: '1.0',
                    image: `https://via.placeholder.com/100/808080/FFFFFF?text=Prize${poolForm.items.length + 1}`,
                    description: 'New prize description'
                }]
            });
        }
    };

    const removeItem = (index) => {
        if (poolForm.items.length > 1) {
            const newItems = poolForm.items.filter((_, i) => i !== index);
            setPoolForm({ ...poolForm, items: newItems });
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
            {/* Header */}
            <div className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 to-pink-600/20"></div>
                <nav className="relative z-10 flex justify-between items-center p-6 bg-black/20 backdrop-blur-sm">
                    <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center">
                            <span className="text-white font-bold text-xl">🎰</span>
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-white">SpinToWin</h1>
                            <p className="text-gray-300 text-sm">Solana Company Pool Game</p>
                        </div>
                    </div>
                    <WalletMultiButton className="!bg-gradient-to-r !from-purple-600 !to-pink-600 hover:!from-purple-700 hover:!to-pink-700 transition-all duration-300 !rounded-xl" />
                </nav>
            </div>

            <div className="container mx-auto px-6 py-8">
                {/* Progress Steps */}
                <div className="mb-12">
                    <div className="flex justify-center items-center space-x-4 mb-8">
                        {[1, 2, 3, 4, 5].map((num) => (
                            <div key={num} className="flex items-center">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-300 ${step >= num
                                    ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-white shadow-lg'
                                    : 'bg-gray-600 text-gray-300'
                                    }`}>
                                    {step > num ? '✓' : num}
                                </div>
                                {num < 5 && (
                                    <div className={`w-12 h-1 transition-all duration-300 ${step > num ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-gray-600'
                                        }`}></div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-white mb-2">
                            {step === 1 && 'Create Company Pool'}
                            {step === 2 && 'Purchase Ticket'}
                            {step === 3 && 'Spin the Wheel'}
                            {step === 4 && 'Claim Your Reward'}
                            {step === 5 && 'Game Complete!'}
                        </h2>
                        <p className="text-gray-300">
                            {step === 1 && 'Set up your company pool with prizes and ticket price'}
                            {step === 2 && 'Buy a ticket to participate in the spin game'}
                            {step === 3 && 'Spin the wheel to win amazing prizes'}
                            {step === 4 && 'Claim your well-deserved reward'}
                            {step === 5 && 'Congratulations on completing the game!'}
                        </p>
                    </div>
                </div>

                {/* Status Messages */}
                {status && (
                    <div className="mb-6 p-4 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl backdrop-blur-sm">
                        <p className="text-green-300 text-center font-medium">{status}</p>
                        {txSignature && (
                            <p className="text-green-200 text-center text-sm mt-2">
                                Transaction: <a href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-100">
                                    {txSignature.slice(0, 8)}...{txSignature.slice(-8)}
                                </a>
                            </p>
                        )}
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-gradient-to-r from-red-500/20 to-rose-500/20 border border-red-500/30 rounded-xl backdrop-blur-sm">
                        <p className="text-red-300 text-center font-medium">{error}</p>
                    </div>
                )}

                {/* Step Content */}
                <div className="max-w-6xl mx-auto">
                    {/* Step 1: Initialize Pool */}
                    {step === 1 && (
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
                            <h3 className="text-2xl font-bold text-white mb-6">Create Your Company Pool</h3>

                            <div className="grid lg:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">Company Name</label>
                                            <input
                                                type="text"
                                                value={poolForm.companyName}
                                                onChange={(e) => setPoolForm({ ...poolForm, companyName: e.target.value })}
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors"
                                                placeholder="Enter company name"
                                                maxLength={50}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">Ticket Price (SOL)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                value={poolForm.ticketPrice}
                                                onChange={(e) => setPoolForm({ ...poolForm, ticketPrice: e.target.value })}
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors"
                                                placeholder="0.1"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">Company Image URL</label>
                                        <input
                                            type="url"
                                            value={poolForm.companyImage}
                                            onChange={(e) => setPoolForm({ ...poolForm, companyImage: e.target.value })}
                                            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors"
                                            placeholder="https://example.com/image.png"
                                            maxLength={200}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                        <h4 className="text-lg font-semibold text-white mb-3">Preview</h4>
                                        <div className="text-center">
                                            <img
                                                src={poolForm.companyImage}
                                                alt={poolForm.companyName}
                                                className="w-32 h-20 mx-auto rounded-lg object-cover mb-3 border border-white/20"
                                                onError={(e) => {
                                                    e.target.src = 'https://via.placeholder.com/128x80/6366F1/FFFFFF?text=Preview';
                                                }}
                                            />
                                            <h5 className="text-white font-semibold">{poolForm.companyName}</h5>
                                            <p className="text-gray-300 text-sm">Ticket: {poolForm.ticketPrice} SOL</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="text-lg font-semibold text-white">Prize Items ({poolForm.items.length}/10)</h4>
                                    <button
                                        onClick={addItem}
                                        disabled={poolForm.items.length >= 10}
                                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                                    >
                                        Add Item
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {poolForm.items.map((item, index) => (
                                        <div key={index} className="grid grid-cols-1 md:grid-cols-6 gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Name</label>
                                                <input
                                                    type="text"
                                                    value={item.name}
                                                    onChange={(e) => {
                                                        const newItems = [...poolForm.items];
                                                        newItems[index].name = e.target.value;
                                                        setPoolForm({ ...poolForm, items: newItems });
                                                    }}
                                                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors text-sm"
                                                    placeholder="Prize name"
                                                    maxLength={50}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Price (SOL)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0.01"
                                                    value={item.price}
                                                    onChange={(e) => {
                                                        const newItems = [...poolForm.items];
                                                        newItems[index].price = e.target.value;
                                                        setPoolForm({ ...poolForm, items: newItems });
                                                    }}
                                                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors text-sm"
                                                    placeholder="1.0"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Image URL</label>
                                                <input
                                                    type="url"
                                                    value={item.image}
                                                    onChange={(e) => {
                                                        const newItems = [...poolForm.items];
                                                        newItems[index].image = e.target.value;
                                                        setPoolForm({ ...poolForm, items: newItems });
                                                    }}
                                                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors text-sm"
                                                    placeholder="Image URL"
                                                    maxLength={200}
                                                />
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className="block text-xs text-gray-400 mb-1">Description</label>
                                                <input
                                                    type="text"
                                                    value={item.description}
                                                    onChange={(e) => {
                                                        const newItems = [...poolForm.items];
                                                        newItems[index].description = e.target.value;
                                                        setPoolForm({ ...poolForm, items: newItems });
                                                    }}
                                                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-purple-400 focus:outline-none transition-colors text-sm"
                                                    placeholder="Prize description"
                                                    maxLength={200}
                                                />
                                            </div>
                                            <div className="flex items-end">
                                                <button
                                                    onClick={() => removeItem(index)}
                                                    disabled={poolForm.items.length <= 1}
                                                    className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={initializePool}
                                disabled={loading || !wallet.publicKey || poolForm.items.length === 0}
                                className="w-full mt-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg"
                            >
                                {loading ? 'Initializing Pool...' : 'Initialize Company Pool 🚀'}
                            </button>
                        </div>
                    )}

                    {/* Step 2: Buy Ticket */}
                    {step === 2 && companyPool && (
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
                            <h3 className="text-2xl font-bold text-white mb-6">Purchase Your Ticket</h3>

                            <div className="grid lg:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-6 border border-purple-300/30">
                                        <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
                                            <span className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center mr-3 text-sm">ℹ️</span>
                                            Pool Information
                                        </h4>
                                        <div className="space-y-3 text-gray-300">
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Company:</span>
                                                <span>{companyPool.companyName}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Ticket Price:</span>
                                                <span className="text-green-400 font-bold">{companyPool.ticketPrice.toNumber() / LAMPORTS_PER_SOL} SOL</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Tickets Sold:</span>
                                                <span>{companyPool.totalTicketsSold.toNumber()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Pool Balance:</span>
                                                <span className="text-blue-400">{companyPool.totalFunds.toNumber() / LAMPORTS_PER_SOL} SOL</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-6 border border-green-300/30">
                                        <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
                                            <span className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mr-3 text-sm">🎁</span>
                                            Available Prizes
                                        </h4>
                                        <div className="space-y-3 max-h-64 overflow-y-auto">
                                            {companyPool.items.map((item, index) => (
                                                <div key={index} className="flex items-center justify-between py-2 border-b border-white/10 last:border-b-0">
                                                    <div className="flex items-center space-x-3">
                                                        <img
                                                            src={item.image}
                                                            alt={item.name}
                                                            className="w-8 h-8 rounded object-cover border border-white/20"
                                                            onError={(e) => {
                                                                e.target.src = 'https://via.placeholder.com/32/6366F1/FFFFFF?text=?';
                                                            }}
                                                        />
                                                        <span className="text-gray-300">{item.name}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-green-400 font-medium">{item.price.toNumber() / LAMPORTS_PER_SOL} SOL</span>
                                                        <div className="text-xs text-gray-400">
                                                            {(item.probability / 100).toFixed(1)}% chance
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col justify-center">
                                    <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-xl p-8 border border-yellow-300/30 text-center">
                                        <div className="w-24 h-24 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                            <span className="text-4xl">🎫</span>
                                        </div>
                                        <h4 className="text-2xl font-bold text-white mb-4">Ready to Play?</h4>
                                        <p className="text-gray-300 mb-6">
                                            Purchase your ticket now and get ready to spin for amazing prizes!
                                            Each ticket gives you one chance to win.
                                        </p>
                                        <div className="bg-white/10 rounded-lg p-4 mb-6">
                                            <div className="text-3xl font-bold text-green-400">
                                                {companyPool.ticketPrice.toNumber() / LAMPORTS_PER_SOL} SOL
                                            </div>
                                            <div className="text-gray-300 text-sm">per ticket</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={buyTicket}
                                disabled={loading || !wallet.publicKey}
                                className="w-full mt-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg"
                            >
                                {loading ? 'Purchasing Ticket...' : `Buy Ticket for ${companyPool.ticketPrice.toNumber() / LAMPORTS_PER_SOL} SOL 🎫`}
                            </button>
                        </div>
                    )}

                    {/* Step 3: Spin Wheel */}
                    {step === 3 && companyPool && userTicket && (
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
                            <h3 className="text-2xl font-bold text-white mb-6 text-center">Time to Spin the Wheel!</h3>

                            <div className="grid lg:grid-cols-3 gap-8">
                                <div className="lg:col-span-2 flex flex-col items-center">
                                    <div className="mb-8">
                                        <SpinWheel
                                            items={companyPool.items}
                                            isSpinning={isSpinning}
                                            onSpinComplete={onSpinComplete}
                                            winner={spinResult}
                                        />
                                    </div>

                                    <button
                                        onClick={spinWheel}
                                        disabled={loading || isSpinning || userTicket.used || !wallet.publicKey}
                                        className="px-16 py-4 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg text-xl"
                                    >
                                        {isSpinning ? '🎰 Spinning...' : loading ? 'Processing...' : userTicket.used ? '✅ Ticket Used' : '🎰 SPIN NOW!'}
                                    </button>

                                    {isSpinning && (
                                        <div className="mt-6 text-center">
                                            <div className="inline-flex items-center space-x-2 text-yellow-400">
                                                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce"></div>
                                                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                                <span className="ml-2 font-medium">The wheel is spinning...</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl p-6 border border-blue-300/30 mb-6">
                                        <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
                                            <span className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center mr-3 text-sm">🎫</span>
                                            Your Ticket
                                        </h4>
                                        <div className="space-y-3 text-gray-300">
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Ticket ID:</span>
                                                <span>#{userTicket.ticketId.toString()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Status:</span>
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${userTicket.used ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'
                                                    }`}>
                                                    {userTicket.used ? 'Used' : 'Valid'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="font-medium text-white">Pool:</span>
                                                <span className="text-purple-400 text-sm">{companyPool.companyName}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-6 border border-purple-300/30">
                                        <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
                                            <span className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center mr-3 text-sm">🎯</span>
                                            How It Works
                                        </h4>
                                        <div className="space-y-3 text-gray-300 text-sm">
                                            <div className="flex items-start space-x-2">
                                                <span className="text-green-400 font-bold">1.</span>
                                                <span>Click the SPIN button to start the wheel</span>
                                            </div>
                                            <div className="flex items-start space-x-2">
                                                <span className="text-blue-400 font-bold">2.</span>
                                                <span>Watch the wheel spin and land on a prize</span>
                                            </div>
                                            <div className="flex items-start space-x-2">
                                                <span className="text-purple-400 font-bold">3.</span>
                                                <span>Each prize has different probability chances</span>
                                            </div>
                                            <div className="flex items-start space-x-2">
                                                <span className="text-orange-400 font-bold">4.</span>
                                                <span>Higher value prizes have lower chances</span>
                                            </div>
                                            <div className="flex items-start space-x-2">
                                                <span className="text-pink-400 font-bold">5.</span>
                                                <span>Claim your reward after winning!</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 4: Claim Reward */}
                    {step === 4 && userTicket && userTicket.wonItem && (
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
                            <div className="text-center">
                                <div className="mb-8">
                                    <div className="w-32 h-32 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                                        <span className="text-6xl">🏆</span>
                                    </div>
                                    <h3 className="text-4xl font-bold text-white mb-4">🎉 Congratulations! 🎉</h3>
                                    <p className="text-xl text-gray-300">You won an amazing prize!</p>
                                </div>

                                <div className="max-w-md mx-auto mb-8">
                                    <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-8 border border-purple-300/30">
                                        <div className="mb-6">
                                            <img
                                                src={userTicket.wonItem.image}
                                                alt={userTicket.wonItem.name}
                                                className="w-32 h-32 mx-auto rounded-xl object-cover border-4 border-white/20 shadow-lg"
                                                onError={(e) => {
                                                    e.target.src = 'https://via.placeholder.com/128/6366F1/FFFFFF?text=Prize';
                                                }}
                                            />
                                        </div>
                                        <h4 className="text-3xl font-bold text-white mb-3">{userTicket.wonItem.name}</h4>
                                        <p className="text-gray-300 mb-6 text-lg">{userTicket.wonItem.description}</p>
                                        <div className="bg-green-500/20 rounded-lg p-4 border border-green-500/30">
                                            <div className="text-4xl font-bold text-green-400 mb-1">
                                                {userTicket.wonItem.price / LAMPORTS_PER_SOL} SOL
                                            </div>
                                            <div className="text-green-300 text-sm">Prize Value</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col items-center space-y-4">
                                    <button
                                        onClick={claimReward}
                                        disabled={loading || !canClaim || userTicket.rewardClaimed || !wallet.publicKey}
                                        className="px-16 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg text-xl"
                                    >
                                        {loading ? '⏳ Claiming...' : userTicket.rewardClaimed ? '✅ Reward Claimed!' : '💰 Claim Your Reward'}
                                    </button>

                                    {userTicket.rewardClaimed && (
                                        <div className="mt-6 p-6 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl max-w-lg">
                                            <div className="flex items-center justify-center space-x-2 mb-2">
                                                <span className="text-2xl">🎊</span>
                                                <h5 className="text-green-300 font-bold text-lg">Reward Successfully Claimed!</h5>
                                                <span className="text-2xl">🎊</span>
                                            </div>
                                            <p className="text-green-200 text-center">
                                                {userTicket.wonItem.price / LAMPORTS_PER_SOL} SOL has been transferred to your wallet!
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 5: Game Complete */}
                    {step === 5 && (
                        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 text-center">
                            <div className="mb-8">
                                <div className="w-40 h-40 bg-gradient-to-br from-yellow-400 via-orange-500 to-red-500 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse">
                                    <span className="text-8xl">🎊</span>
                                </div>
                                <h3 className="text-5xl font-bold text-white mb-4">Game Complete!</h3>
                                <p className="text-xl text-gray-300 mb-8">
                                    Thank you for playing SpinToWin! You've successfully completed the entire gaming experience.
                                </p>
                            </div>

                            <div className="grid md:grid-cols-3 gap-6 mb-8">
                                <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-xl p-6 border border-blue-300/30">
                                    <h4 className="text-lg font-semibold text-white mb-4 flex items-center justify-center">
                                        <span className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center mr-2 text-sm">📊</span>
                                        Game Summary
                                    </h4>
                                    <div className="space-y-2 text-left text-gray-300 text-sm">
                                        <div className="flex justify-between">
                                            <span className="font-medium text-white">Company:</span>
                                            <span>{companyPool?.companyName}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-white">Ticket Cost:</span>
                                            <span>{companyPool?.ticketPrice.toNumber() / LAMPORTS_PER_SOL} SOL</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-white">Prize Won:</span>
                                            <span>{userTicket?.wonItem?.name}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-white">Prize Value:</span>
                                            <span className="text-green-400">{userTicket?.wonItem?.price / LAMPORTS_PER_SOL} SOL</span>
                                        </div>
                                        <div className="flex justify-between border-t border-white/20 pt-2">
                                            <span className="font-medium text-white">Net Result:</span>
                                            <span className={`font-bold ${(userTicket?.wonItem?.price - companyPool?.ticketPrice.toNumber()) > 0
                                                ? 'text-green-400'
                                                : 'text-red-400'
                                                }`}>
                                                {((userTicket?.wonItem?.price || 0) - (companyPool?.ticketPrice.toNumber() || 0)) / LAMPORTS_PER_SOL > 0 ? '+' : ''}
                                                {((userTicket?.wonItem?.price || 0) - (companyPool?.ticketPrice.toNumber() || 0)) / LAMPORTS_PER_SOL} SOL
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-6 border border-purple-300/30">
                                    <h4 className="text-lg font-semibold text-white mb-4 flex items-center justify-center">
                                        <span className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center mr-2 text-sm">✅</span>
                                        Achievements
                                    </h4>
                                    <div className="space-y-2 text-left text-gray-300 text-sm">
                                        <div className="flex items-center space-x-2">
                                            <span className="text-green-400">✓</span>
                                            <span>Created company pool</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-green-400">✓</span>
                                            <span>Purchased ticket with SOL</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-green-400">✓</span>
                                            <span>Spun the probability wheel</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-green-400">✓</span>
                                            <span>Won a prize item</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-green-400">✓</span>
                                            <span>Claimed SOL reward</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-yellow-400">🏆</span>
                                            <span className="text-yellow-400 font-semibold">SpinToWin Master!</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-6 border border-green-300/30">
                                    <h4 className="text-lg font-semibold text-white mb-4 flex items-center justify-center">
                                        <span className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mr-2 text-sm">🔗</span>
                                        Blockchain
                                    </h4>
                                    <div className="space-y-2 text-left text-gray-300 text-sm">
                                        <div>
                                            <span className="font-medium text-white">Network:</span>
                                            <span className="ml-2 text-purple-400">Solana Devnet</span>
                                        </div>
                                        <div>
                                            <span className="font-medium text-white">Program:</span>
                                            <div className="text-blue-400 font-mono text-xs break-all">
                                                {PROGRAM_ID.toString()}
                                            </div>
                                        </div>
                                        {txSignature && (
                                            <div>
                                                <span className="font-medium text-white">Last Tx:</span>
                                                <div className="text-green-400 font-mono text-xs">
                                                    <a
                                                        href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="hover:underline"
                                                    >
                                                        {txSignature.slice(0, 8)}...{txSignature.slice(-8)}
                                                    </a>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-center space-x-4">
                                <button
                                    onClick={resetGame}
                                    className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg"
                                >
                                    🎮 Play Again
                                </button>
                                <button
                                    onClick={() => window.open('https://github.com/solana-labs/solana-program-library', '_blank')}
                                    className="px-8 py-3 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg"
                                >
                                    📚 Learn Solana
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Developer Info Panel */}
                {wallet.publicKey && (
                    <div className="mt-12 max-w-6xl mx-auto">
                        <div className="bg-black/20 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
                            <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
                                <span className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center mr-3 text-sm">🔧</span>
                                Developer Information
                            </h4>
                            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                                <div>
                                    <p className="text-gray-400 mb-1">Wallet Connected</p>
                                    <p className="text-green-400 font-mono text-xs">
                                        {wallet.publicKey.toString().slice(0, 8)}...{wallet.publicKey.toString().slice(-8)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-gray-400 mb-1">Program ID</p>
                                    <p className="text-blue-400 font-mono text-xs">
                                        {PROGRAM_ID.toString().slice(0, 8)}...{PROGRAM_ID.toString().slice(-8)}
                                    </p>
                                </div>
                                {poolPda && (
                                    <div>
                                        <p className="text-gray-400 mb-1">Pool PDA</p>
                                        <p className="text-purple-400 font-mono text-xs">
                                            {poolPda.toString().slice(0, 8)}...{poolPda.toString().slice(-8)}
                                        </p>
                                    </div>
                                )}
                                {ticketPda && (
                                    <div>
                                        <p className="text-gray-400 mb-1">Ticket PDA</p>
                                        <p className="text-pink-400 font-mono text-xs">
                                            {ticketPda.toString().slice(0, 8)}...{ticketPda.toString().slice(-8)}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Welcome Screen for Non-Connected Wallets */}
                {!wallet.publicKey && (
                    <div className="mt-12 max-w-4xl mx-auto text-center">
                        <div className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-2xl p-12 border border-orange-300/30">
                            <div className="mb-8">
                                <div className="w-32 h-32 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <span className="text-6xl">🎰</span>
                                </div>
                                <h4 className="text-4xl font-bold text-white mb-4">Welcome to SpinToWin!</h4>
                                <p className="text-xl text-gray-300 mb-8">
                                    The ultimate Solana-powered spin-to-win gaming experience.
                                    Connect your wallet to start creating and playing with company pools.
                                </p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-8 mb-8">
                                <div className="space-y-4">
                                    <h5 className="text-xl font-semibold text-white flex items-center justify-center">
                                        <span className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center mr-2 text-sm">🎮</span>
                                        Game Features
                                    </h5>
                                    <ul className="text-gray-300 space-y-2 text-left">
                                        <li className="flex items-center"><span className="text-green-400 mr-2">✓</span> Create custom company pools</li>
                                        <li className="flex items-center"><span className="text-green-400 mr-2">✓</span> Set ticket prices and prizes</li>
                                        <li className="flex items-center"><span className="text-green-400 mr-2">✓</span> Probability-based fair gaming</li>
                                        <li className="flex items-center"><span className="text-green-400 mr-2">✓</span> Instant SOL rewards</li>
                                        <li className="flex items-center"><span className="text-green-400 mr-2">✓</span> Transparent blockchain transactions</li>
                                    </ul>
                                </div>
                                <div className="space-y-4">
                                    <h5 className="text-xl font-semibold text-white flex items-center justify-center">
                                        <span className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center mr-2 text-sm">⚡</span>
                                        Technology Stack
                                    </h5>
                                    <ul className="text-gray-300 space-y-2 text-left">
                                        <li className="flex items-center"><span className="text-purple-400 mr-2">•</span> Solana blockchain</li>
                                        <li className="flex items-center"><span className="text-purple-400 mr-2">•</span> Anchor framework</li>
                                        <li className="flex items-center"><span className="text-purple-400 mr-2">•</span> React & TypeScript</li>
                                        <li className="flex items-center"><span className="text-purple-400 mr-2">•</span> Wallet adapter integration</li>
                                        <li className="flex items-center"><span className="text-purple-400 mr-2">•</span> Modern responsive UI</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-xl p-6 border border-purple-400/30 mb-8">
                                <h5 className="text-lg font-semibold text-white mb-3">How to Get Started</h5>
                                <div className="grid md:grid-cols-4 gap-4 text-sm">
                                    <div className="text-center">
                                        <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-2 text-white font-bold">1</div>
                                        <p className="text-gray-300">Connect your Solana wallet</p>
                                    </div>
                                    <div className="text-center">
                                        <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2 text-white font-bold">2</div>
                                        <p className="text-gray-300">Create a company pool</p>
                                    </div>
                                    <div className="text-center">
                                        <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-2 text-white font-bold">3</div>
                                        <p className="text-gray-300">Buy tickets and spin</p>
                                    </div>
                                    <div className="text-center">
                                        <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center mx-auto mb-2 text-white font-bold">4</div>
                                        <p className="text-gray-300">Win prizes and claim rewards</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-center space-y-4">
                                <p className="text-gray-300 text-lg">Ready to start spinning?</p>
                                <WalletMultiButton className="!bg-gradient-to-r !from-purple-600 !to-pink-600 hover:!from-purple-700 hover:!to-pink-700 !text-white !font-bold !py-3 !px-8 !rounded-xl !text-lg !shadow-lg transform hover:scale-105 transition-all duration-300" />
                                <p className="text-gray-400 text-sm mt-4">
                                    Make sure you're on Solana Devnet with some SOL for testing
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer className="mt-16 py-8 bg-black/30 backdrop-blur-sm border-t border-white/10">
                <div className="container mx-auto px-6">
                    <div className="grid md:grid-cols-3 gap-8">
                        <div>
                            <div className="flex items-center space-x-2 mb-4">
                                <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center">
                                    <span className="text-white font-bold text-sm">🎰</span>
                                </div>
                                <h5 className="text-white font-bold text-lg">SpinToWin</h5>
                            </div>
                            <p className="text-gray-400 text-sm">
                                A decentralized spin-to-win gaming platform built on Solana blockchain.
                                Fair, transparent, and instantly rewarding.
                            </p>
                        </div>
                        <div>
                            <h5 className="text-white font-semibold mb-4">Quick Links</h5>
                            <ul className="space-y-2 text-gray-400 text-sm">
                                <li><a href="#" className="hover:text-white transition-colors">How to Play</a></li>
                                <li><a href="#" className="hover:text-white transition-colors">Game Rules</a></li>
                                <li><a href="#" className="hover:text-white transition-colors">Probability Guide</a></li>
                                <li><a href="https://docs.solana.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Solana Docs</a></li>
                            </ul>
                        </div>
                        <div>
                            <h5 className="text-white font-semibold mb-4">Network Info</h5>
                            <div className="space-y-2 text-gray-400 text-sm">
                                <p>Network: <span className="text-purple-400">Solana Devnet</span></p>
                                <p>Program ID:</p>
                                <p className="font-mono text-xs text-blue-400 break-all">{PROGRAM_ID.toString()}</p>
                                <p className="text-xs mt-2">
                                    Built with ❤️ using Anchor Framework
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-white/10 mt-8 pt-6 text-center">
                        <p className="text-gray-400 text-sm">
                            © 2024 SpinToWin • Powered by Solana Blockchain •
                            <span className="ml-2 text-purple-400">Fair Gaming • Instant Rewards</span>
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
}