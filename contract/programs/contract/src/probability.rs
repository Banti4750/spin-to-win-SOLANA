// probability.rs
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use crate::{PoolItem, ErrorCode};

const BASIS_POINTS: u32 = 10_000; // 100% = 10,000 basis points
const MAX_HOUSE_EDGE: u32 = 2_000; // Max 20% house edge
const MIN_HOUSE_EDGE: u32 = 500;   // Min 5% house edge
const MIN_PROBABILITY: u32 = 10;    // Min 0.1% chance (dynamically adjusted)

pub struct ProbabilityCalculator;

impl ProbabilityCalculator {
    pub fn calculate_probabilities(
        item_values: &[u64],
        ticket_price: u64,
    ) -> Result<(Vec<u32>, u32)> {
        require!(!item_values.is_empty(), ErrorCode::NoItemsProvided);
        require!(ticket_price > 0, ErrorCode::InvalidTicketPrice);

        let total_item_value: u64 = item_values.iter().sum();
        let mut house_edge = Self::calculate_optimal_house_edge(total_item_value, ticket_price)?;
        
        let mut probabilities = Vec::with_capacity(item_values.len());
        let mut total_probability = 0u32;

        // Calculate probabilities with dynamic minimums
        for &value in item_values {
            let prob = Self::calculate_item_probability(value, ticket_price, house_edge)?;
            probabilities.push(prob);
            total_probability = total_probability.checked_add(prob).ok_or(ErrorCode::MathOverflow)?;
        }

        // Normalize and adjust house edge if needed
        let (normalized_probs, adjusted_edge) = 
            Self::normalize_and_adjust(probabilities, total_probability, house_edge, item_values, ticket_price)?;

        Ok((normalized_probs, adjusted_edge))
    }

    fn calculate_optimal_house_edge(total_item_value: u64, ticket_price: u64) -> Result<u32> {
        // Base edge is 15% but adjusts between 5-20% based on risk
        let base_edge = 1_500; // 15%
        
        // If total item value is high relative to ticket price, increase edge for safety
        let value_ratio = total_item_value.checked_div(ticket_price).unwrap_or(1);
        let edge_adjustment = (value_ratio as u32).saturating_sub(10) * 50; // 0.5% per 10x ratio
        
        let calculated_edge = base_edge.saturating_add(edge_adjustment)
            .clamp(MIN_HOUSE_EDGE, MAX_HOUSE_EDGE);
        
        Ok(calculated_edge)
    }

    fn calculate_item_probability(
        item_value: u64,
        ticket_price: u64,
        house_edge: u32,
    ) -> Result<u32> {
        let payout_per_ticket = (ticket_price as u128 * (BASIS_POINTS - house_edge) as u128) 
            / BASIS_POINTS as u128;

        // Dynamic minimum probability (at least 0.1% or 1/(10*value_ratio))
        let min_prob = (BASIS_POINTS / (10 * (item_value / payout_per_ticket).max(1) as u32)
            .max(MIN_PROBABILITY));

        // Fair probability calculation
        let fair_prob = (payout_per_ticket * BASIS_POINTS as u128 / item_value as u128) as u32;
        
        Ok(fair_prob.max(min_prob))
    }

    fn normalise_and_adjust(
        mut probabilities: Vec<u32>,
        total_probability: u32,
        mut house_edge: u32,
        item_values: &[u64],
        ticket_price: u64,
    ) -> Result<(Vec<u32>, u32)> {
        if total_probability == 0 {
            return Err(ErrorCode::MathOverflow.into());
        }

        // First normalization pass
        if total_probability > BASIS_POINTS {
            // Scale down probabilities proportionally
            for prob in &mut probabilities {
                *prob = (*prob as u128 * BASIS_POINTS as u128 / total_probability as u128) as u32;
            }
        } else if total_probability < BASIS_POINTS {
            // If under 100%, we can afford to reduce house edge
            let missing_prob = BASIS_POINTS - total_probability;
            let edge_reduction = (missing_prob * house_edge) / BASIS_POINTS;
            house_edge = house_edge.saturating_sub(edge_reduction);
            
            // Recalculate with new edge
            return Self::calculate_probabilities(item_values, ticket_price);
        }

        // Second pass: Ensure no single item dominates
        let max_prob = *probabilities.iter().max().unwrap_or(&0);
        if max_prob > BASIS_POINTS / 2 {
            // If any item has >50% chance, adjust
            house_edge = house_edge.saturating_add(500); // +5% edge
            return Self::calculate_probabilities(item_values, ticket_price);
        }

        Ok((probabilities, house_edge))
    }

    pub fn create_weighted_list(items: &[PoolItem]) -> Vec<usize> {
        let mut weighted_list = Vec::new();
        let total_prob: u32 = items.iter().map(|i| i.probability).sum();
        
        // Use floating-point for accurate distribution
        let scale_factor = 10_000.0 / total_prob as f64;

        for (idx, item) in items.iter().enumerate() {
            if !item.available {
                continue;
            }

            let weight = ((item.probability as f64 * scale_factor).round() as u32).max(1);
            weighted_list.extend(std::iter::repeat(idx).take(weight as usize));
        }

        weighted_list
    }

    pub fn select_random_item(
        weighted_list: &[usize],
        seed: i64,
        user_key: Pubkey,
    ) -> Result<usize> {
        require!(!weighted_list.is_empty(), ErrorCode::NoItemsAvailable);

        // More robust randomness using multiple hash bytes
        let hash_input = format!("{}{}{}", seed, user_key, Clock::get()?.unix_timestamp);
        let hash_result = hash(hash_input.as_bytes());
        
        let bytes = hash_result.as_ref();
        let random_num = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], 
            bytes[4], bytes[5], bytes[6], bytes[7]
        ]) as usize % weighted_list.len();

        Ok(weighted_list[random_num])
    }
}