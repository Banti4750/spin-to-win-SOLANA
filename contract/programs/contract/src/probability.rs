use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct WeightedItem {
    pub name: String,
    pub value: u64,
    pub weight: f64,
    pub probability: u32, // Stored as basis points (1 = 0.01%)
}

pub struct WeightedProbabilityCalculator {
    pub items: Vec<WeightedItem>,
    pub ticket_price: u64,
    pub total_weight: f64,
}

impl WeightedProbabilityCalculator {
    pub fn new(items: Vec<(String, u64)>, ticket_price: u64) -> Self {
        let mut calculator = Self {
            items: items
                .into_iter()
                .map(|(name, value)| WeightedItem {
                    name,
                    value,
                    weight: 0.0,
                    probability: 0,
                })
                .collect(),
            ticket_price,
            total_weight: 0.0,
        };

        calculator.calculate_weights_advanced();
        calculator
    }

    // Simple inverse value weighting (higher value = lower probability)
    pub fn calculate_weights_simple(&mut self) {
        self.total_weight = 0.0;

        // Use inverse of value as weight with safety checks
        for item in &mut self.items {
            item.weight = 1.0 / (item.value as f64).max(f64::MIN_POSITIVE);
            self.total_weight += item.weight;
        }

        self.normalize_probabilities();
    }

    // Advanced weighting based on ticket price ratio
    pub fn calculate_weights_advanced(&mut self) {
        self.total_weight = 0.0;

        for item in &mut self.items {
            // Weight based on how many tickets needed to buy the product
            let tickets_needed = (item.value as f64) / (self.ticket_price as f64);
            
            // Higher value items have exponentially lower probability
            // Using power of 1.5 as in original code
            item.weight = 1.0 / tickets_needed.powf(1.5).max(f64::MIN_POSITIVE);
            self.total_weight += item.weight;
        }

        self.normalize_probabilities();
    }

    fn normalize_probabilities(&mut self) {
        // Calculate individual probabilities and normalize to sum to 10000
        let mut total_probability = 0u32;
        
        // Store the length to avoid borrowing issues
        let items_len = self.items.len();
        
        for item in &mut self.items {
            let probability_float = item.weight / self.total_weight.max(f64::MIN_POSITIVE);
            // Scale by 10000 for precision
            item.probability = (probability_float * 10000.0).round() as u32;
            total_probability = total_probability.saturating_add(item.probability);
        }

        // Normalize probabilities to ensure they sum exactly to 10000
        if total_probability > 0 && total_probability != 10000 {
            let scale_factor = 10000.0 / (total_probability as f64);
            let mut running_total = 0u32;
            
            for (i, item) in self.items.iter_mut().enumerate() {
                if i == items_len - 1 {
                    // Last item gets the remainder to ensure exact sum of 10000
                    item.probability = 10000 - running_total;
                } else {
                    item.probability = ((item.probability as f64) * scale_factor).round() as u32;
                    running_total = running_total.saturating_add(item.probability);
                }
            }
        }
    }

    // Get probability of a specific item (returns value between 0.0 and 1.0)
    pub fn get_probability_of_item(&self, item_name: &str) -> f64 {
        self.items
            .iter()
            .find(|item| item.name == item_name)
            .map(|item| (item.probability as f64) / 10000.0)
            .unwrap_or(0.0)
    }

    // Get probability of getting a specific item at least once in k spins
    pub fn get_probability_in_k_spins(&self, item_name: &str, spins: u32) -> f64 {
        let single_probability = self.get_probability_of_item(item_name);
        1.0 - (1.0 - single_probability).powi(spins as i32)
    }

    // Calculate expected number of spins to get a specific item
    pub fn get_expected_spins_for_item(&self, item_name: &str) -> f64 {
        let probability = self.get_probability_of_item(item_name);
        if probability <= 0.0 {
            return f64::INFINITY;
        }
        1.0 / probability
    }

    // Get all items with their calculated probabilities
    pub fn get_items_with_probabilities(&self) -> Vec<(String, u64, u32)> {
        self.items
            .iter()
            .map(|item| (item.name.clone(), item.value, item.probability))
            .collect()
    }

    // Validate that probabilities sum to 10000 (100%)
    pub fn validate_probabilities(&self) -> bool {
        let total: u32 = self.items.iter().map(|item| item.probability).sum();
        total == 10000
    }

    // Get profitability analysis for an item
    pub fn get_profitability_analysis(&self, item_name: &str) -> Option<ProfitabilityAnalysis> {
        let item = self.items.iter().find(|item| item.name == item_name)?;
        let expected_spins = self.get_expected_spins_for_item(item_name);
        
        if !expected_spins.is_finite() {
            return None;
        }

        let expected_cost = expected_spins * (self.ticket_price as f64);
        let profit = (item.value as f64) - expected_cost;
        let profit_ratio = profit / expected_cost.max(f64::MIN_POSITIVE);

        Some(ProfitabilityAnalysis {
            item_name: item_name.to_string(),
            expected_spins,
            expected_cost,
            item_value: item.value,
            profit,
            profit_ratio,
        })
    }
}

#[derive(Debug)]
pub struct ProfitabilityAnalysis {
    pub item_name: String,
    pub expected_spins: f64,
    pub expected_cost: f64,
    pub item_value: u64,
    pub profit: f64,
    pub profit_ratio: f64,
}

// Custom error types for this module
#[derive(Debug)]
pub enum ProbabilityError {
    NoItemsProvided,
    InvalidProbabilityCalculation,
}

impl From<ProbabilityError> for anchor_lang::error::Error {
    fn from(err: ProbabilityError) -> Self {
        match err {
            ProbabilityError::NoItemsProvided => {
                anchor_lang::error::Error::from(crate::ErrorCode::NoItemsProvided)
            }
            ProbabilityError::InvalidProbabilityCalculation => {
                anchor_lang::error::Error::from(crate::ErrorCode::InvalidProbabilityCalculation)
            }
        }
    }
}

// Utility functions for Solana program integration
pub fn calculate_item_probabilities(
    items: &[(String, u64)],
    ticket_price: u64,
) -> Result<Vec<u32>> {
    if items.is_empty() {
        return Err(crate::ErrorCode::NoItemsProvided.into());
    }

    let calculator = WeightedProbabilityCalculator::new(items.to_vec(), ticket_price);
    
    if !calculator.validate_probabilities() {
        return Err(crate::ErrorCode::InvalidProbabilityCalculation.into());
    }

    Ok(calculator.items.iter().map(|item| item.probability).collect())
}

// Select winning item based on weighted probabilities
pub fn select_winning_item_index(
    probabilities: &[u32],
    random_seed: u64,
) -> Option<usize> {
    let total_weight: u32 = probabilities.iter().sum();
    if total_weight == 0 {
        return None;
    }

    let random_value = (random_seed % total_weight as u64) as u32;
    let mut cumulative_weight = 0u32;
    
    for (index, &weight) in probabilities.iter().enumerate() {
        cumulative_weight = cumulative_weight.saturating_add(weight);
        if random_value < cumulative_weight {
            return Some(index);
        }
    }
    
    None
}

// #[cfg(test)]
// mod tests {
//     use super::*;
//     use approx::assert_relative_eq;

//     #[test]
//     fn test_probability_calculation() {
//         let items = vec![
//             ("iPhone".to_string(), 10),
//             ("iPad".to_string(), 50),
//             ("MacBook".to_string(), 200),
//             ("AirPods".to_string(), 1000),
//         ];
        
//         let calculator = WeightedProbabilityCalculator::new(items, 100);
        
//         // Verify probabilities sum to 10000 (100%)
//         assert!(calculator.validate_probabilities());
        
//         // Higher value items should have lower probability
//         let iphone_prob = calculator.get_probability_of_item("iPhone");
//         let airpods_prob = calculator.get_probability_of_item("AirPods");
        
//         assert!(iphone_prob > airpods_prob);
//     }

//     #[test]
//     fn test_single_item() {
//         let single_item = vec![("Prize".to_string(), 100)];
//         let calc = WeightedProbabilityCalculator::new(single_item, 10);
//         assert_eq!(calc.items[0].probability, 10000);
//     }

//     #[test]
//     fn test_equal_value_items() {
//         let equal_items = vec![
//             ("A".to_string(), 100),
//             ("B".to_string(), 100),
//             ("C".to_string(), 100)
//         ];
//         let calc = WeightedProbabilityCalculator::new(equal_items, 10);
//         assert!((3333..=3334).contains(&calc.items[0].probability));
//     }

//     #[test]
//     fn test_random_selection_distribution() {
//         let items = vec![
//             ("Common".to_string(), 100),  // ~70%
//             ("Rare".to_string(), 500),    // ~20%
//             ("Legendary".to_string(), 2000) // ~10%
//         ];
        
//         let calc = WeightedProbabilityCalculator::new(items, 10);
//         let mut results = [0, 0, 0];
        
//         // Simulate 10,000 spins
//         for seed in 0..10_000 {
//             let winner = select_winning_item_index(
//                 &calc.items.iter().map(|i| i.probability).collect::<Vec<_>>(),
//                 seed
//             ).unwrap();
//             results[winner] += 1;
//         }
        
//         // Verify distribution is roughly correct
//         assert!(results[0] > 6500 && results[0] < 7500); // Common
//         assert!(results[1] > 1500 && results[1] < 2500); // Rare
//         assert!(results[2] > 500 && results[2] < 1500);  // Legendary
//     }

//     #[test]
//     fn test_probability_math() {
//         let items = vec![
//             ("A".to_string(), 100),
//             ("B".to_string(), 200)
//         ];
        
//         let calc = WeightedProbabilityCalculator::new(items, 10);
        
//         // Test probability calculations
//         let prob_a = calc.get_probability_of_item("A");
//         let prob_b = calc.get_probability_of_item("B");
        
//         assert_relative_eq!(prob_a + prob_b, 1.0, epsilon = 0.0001);
        
//         // Test expected spins
//         let expected_a = calc.get_expected_spins_for_item("A");
//         assert_relative_eq!(expected_a, 1.0 / prob_a, epsilon = 0.0001);
        
//         // Test probability in k spins
//         let prob_in_10 = calc.get_probability_in_k_spins("A", 10);
//         assert_relative_eq!(
//             prob_in_10,
//             1.0 - (1.0 - prob_a).powi(10),
//             epsilon = 0.0001
//         );
//     }
// }