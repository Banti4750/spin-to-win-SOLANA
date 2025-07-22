// probability.rs
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use crate::{PoolItem, ErrorCode};

const BASIS_POINTS: u32 = 10000; // 100% = 10000 basis points
const MIN_PROBABILITY: u32 = 50; // Minimum 0.5% chance
const HOUSE_EDGE: u32 = 2000; // 20% house edge

pub struct ProbabilityCalculator;

impl ProbabilityCalculator {
    pub fn calculate_probabilities(
        item_values: &[u64],
        ticket_price: u64,
        total_funds: u64,
    ) -> Result<Vec<u32>> {
        require!(!item_values.is_empty(), ErrorCode::NoItemsProvided);
        require!(ticket_price > 0, ErrorCode::InvalidTicketPrice);

        let mut probabilities = vec![0u32; item_values.len()];
        let mut total_probability = 0u32;

        // Calculate expected revenue per spin (considering house edge)
        let expected_revenue = (ticket_price as u128 * (BASIS_POINTS - HOUSE_EDGE) as u128) 
            .checked_div(BASIS_POINTS as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;

        // Calculate base probabilities based on item values
        for (i, &item_value) in item_values.iter().enumerate() {
            probabilities[i] = Self::calculate_item_probability(item_value, expected_revenue)?;
            total_probability = total_probability
                .checked_add(probabilities[i])
                .ok_or(ErrorCode::MathOverflow)?;
        }

        // Normalize probabilities to sum to BASIS_POINTS
        Self::normalize_probabilities(&mut probabilities, total_probability)
    }

    fn calculate_item_probability(item_value: u64, expected_revenue: u64) -> Result<u32> {
        let probability = if item_value <= expected_revenue {
            // Low-value items: higher probability
            let numerator = expected_revenue as u128 * BASIS_POINTS as u128;
            let denominator = (item_value as u128).checked_mul(2).ok_or(ErrorCode::MathOverflow)?;
            (numerator.checked_div(denominator).ok_or(ErrorCode::MathOverflow)?) as u32
        } else {
            // High-value items: lower probability using inverse relationship
            let value_ratio = (item_value as u128 * BASIS_POINTS as u128)
                .checked_div(expected_revenue as u128)
                .ok_or(ErrorCode::MathOverflow)?;
            
            // Use inverse relationship with minimum floor
            let inverse_prob = BASIS_POINTS as u128 / (value_ratio / 100).max(1);
            inverse_prob as u32
        };

        // Ensure minimum probability
        Ok(probability.max(MIN_PROBABILITY))
    }

    fn normalize_probabilities(probabilities: &mut [u32], total_probability: u32) -> Result<Vec<u32>> {
        if total_probability == 0 {
            return Err(ErrorCode::MathOverflow.into());
        }

        if total_probability > BASIS_POINTS {
            // Scale down probabilities proportionally
            for probability in probabilities.iter_mut() {
                *probability = (*probability as u128 * BASIS_POINTS as u128)
                    .checked_div(total_probability as u128)
                    .ok_or(ErrorCode::MathOverflow)? as u32;
                
                // Ensure minimum probability after scaling
                if *probability < MIN_PROBABILITY {
                    *probability = MIN_PROBABILITY;
                }
            }
        } else if total_probability < BASIS_POINTS {
            // Distribute remaining probability proportionally
            let remaining = BASIS_POINTS - total_probability;
            let per_item = remaining / probabilities.len() as u32;
            let remainder = remaining % probabilities.len() as u32;

            for (i, probability) in probabilities.iter_mut().enumerate() {
                *probability = probability.checked_add(per_item).ok_or(ErrorCode::MathOverflow)?;
                if i < remainder as usize {
                    *probability = probability.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
                }
            }
        }

        Ok(probabilities.to_vec())
    }

    pub fn create_weighted_list(items: &[PoolItem]) -> Vec<usize> {
        let mut weighted_list = Vec::new();
        
        for (index, item) in items.iter().enumerate() {
            if !item.available {
                continue;
            }
            
            // Convert probability from basis points to a reasonable weight
            // Divide by 100 to convert from basis points (10000 = 100%) to percentage points
            let weight = (item.probability / 100).max(1); // Ensure at least 1 occurrence
            
            for _ in 0..weight {
                weighted_list.push(index);
            }
        }
        
        weighted_list
    }

    pub fn select_random_item(
        weighted_list: &[usize],
        seed: i64,
        user_key: Pubkey,
    ) -> Result<usize> {
        require!(!weighted_list.is_empty(), ErrorCode::NoItemsAvailable);

        // Generate pseudo-random number using seed and user key
        let hash_input = format!("{}{}", seed, user_key.to_string());
        let hash_result = hash(hash_input.as_bytes());
        let random_num = u32::from_le_bytes([
            hash_result.as_ref()[0],
            hash_result.as_ref()[1],
            hash_result.as_ref()[2],
            hash_result.as_ref()[3],
        ]) as usize % weighted_list.len();

        Ok(weighted_list[random_num])
    }
}