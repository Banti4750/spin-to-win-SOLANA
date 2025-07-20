#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <random>
#include <set>
#include <map>
#include <algorithm>
#include <iomanip>

class WeightedProbabilityCalculator
{
private:
    struct Product
    {
        std::string name;
        int value;
        double weight;
        double probability;
    };

    std::vector<Product> products;
    int ticketPrice;
    double totalWeight;

    // Calculate weights based on inverse value (cheaper items have higher probability)
    void calculateWeights()
    {
        totalWeight = 0.0;

        // Method 1: Inverse value weighting (higher value = lower probability)
        for (auto &product : products)
        {
            // Use inverse of value as weight, with scaling factor
            product.weight = 1.0 / (double)product.value;
            totalWeight += product.weight;
        }

        // Calculate individual probabilities
        for (auto &product : products)
        {
            product.probability = product.weight / totalWeight;
        }
    }

    // Alternative weighting method based on ticket price ratio
    void calculateWeightsAdvanced()
    {
        totalWeight = 0.0;

        for (auto &product : products)
        {
            // Weight based on how many tickets needed to buy the product
            double ticketsNeeded = (double)product.value / ticketPrice;

            // Higher value items have exponentially lower probability
            product.weight = 1.0 / std::pow(ticketsNeeded, 1.5);
            totalWeight += product.weight;
        }

        // Calculate individual probabilities
        for (auto &product : products)
        {
            product.probability = product.weight / totalWeight;
        }
    }

    // Calculate binomial coefficient
    double binomialCoefficient(int n, int k)
    {
        if (k > n || k < 0)
            return 0.0;
        if (k == 0 || k == n)
            return 1.0;

        double result = 1.0;
        for (int i = 0; i < std::min(k, n - k); i++)
        {
            result = result * (n - i) / (i + 1);
        }
        return result;
    }

public:
    // Constructor
    WeightedProbabilityCalculator(const std::vector<std::pair<std::string, int>> &productList, int price)
    {
        ticketPrice = price;

        for (const auto &item : productList)
        {
            Product p;
            p.name = item.first;
            p.value = item.second;
            products.push_back(p);
        }

        calculateWeightsAdvanced(); // Use advanced weighting
    }

    // Get probability of getting a specific product in one spin
    double getProbabilityOfProduct(const std::string &productName)
    {
        for (const auto &product : products)
        {
            if (product.name == productName)
            {
                return product.probability;
            }
        }
        return 0.0; // Product not found
    }

    // Get probability of getting a specific product at least once in k spins
    double getProbabilityOfProductInKSpins(const std::string &productName, int spins)
    {
        double singleProbability = getProbabilityOfProduct(productName);
        if (singleProbability == 0.0)
            return 0.0;

        // P(at least once) = 1 - P(never)
        // P(never) = (1 - p)^k
        return 1.0 - std::pow(1.0 - singleProbability, spins);
    }

    // Calculate probability of getting ALL different products in k spins (Coupon Collector with weights)
    double getProbabilityOfAllProducts(int spins)
    {
        int n = products.size();
        if (spins < n)
            return 0.0;

        // For weighted case, we use simulation as exact calculation is complex
        return simulateAllProducts(spins, 100000);
    }

    // Monte Carlo simulation for getting all products
    double simulateAllProducts(int spins, int iterations = 100000)
    {
        int successes = 0;

        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_real_distribution<> dis(0.0, 1.0);

        for (int iter = 0; iter < iterations; iter++)
        {
            std::set<std::string> collected;

            for (int spin = 0; spin < spins; spin++)
            {
                double randomValue = dis(gen);
                double cumulativeProbability = 0.0;

                // Select product based on weighted probability
                for (const auto &product : products)
                {
                    cumulativeProbability += product.probability;
                    if (randomValue <= cumulativeProbability)
                    {
                        collected.insert(product.name);
                        break;
                    }
                }

                // Check if all products collected
                if (collected.size() == products.size())
                {
                    successes++;
                    break;
                }
            }
        }

        return (double)successes / iterations;
    }

    // Calculate expected number of spins to get a specific product
    double getExpectedSpinsForProduct(const std::string &productName)
    {
        double probability = getProbabilityOfProduct(productName);
        if (probability == 0.0)
            return -1.0;

        // Expected value = 1/p for geometric distribution
        return 1.0 / probability;
    }

    // Calculate expected number of spins to get all products
    double getExpectedSpinsForAllProducts()
    {
        // For weighted coupon collector, use simulation
        int maxSpins = 1000;
        double totalSpins = 0.0;
        int iterations = 10000;

        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_real_distribution<> dis(0.0, 1.0);

        for (int iter = 0; iter < iterations; iter++)
        {
            std::set<std::string> collected;
            int spins = 0;

            while (collected.size() < products.size() && spins < maxSpins)
            {
                spins++;
                double randomValue = dis(gen);
                double cumulativeProbability = 0.0;

                for (const auto &product : products)
                {
                    cumulativeProbability += product.probability;
                    if (randomValue <= cumulativeProbability)
                    {
                        collected.insert(product.name);
                        break;
                    }
                }
            }

            totalSpins += spins;
        }

        return totalSpins / iterations;
    }

    // Display product probabilities
    void displayProbabilities()
    {
        std::cout << "=== PRODUCT PROBABILITIES ===\n";
        std::cout << std::fixed << std::setprecision(4);
        std::cout << "Product\t\tValue\t\tProbability\tWeight\n";
        std::cout << "-------\t\t-----\t\t-----------\t------\n";

        for (const auto &product : products)
        {
            std::cout << product.name << "\t\t₹" << product.value
                      << "\t\t" << (product.probability * 100) << "%"
                      << "\t\t" << product.weight << "\n";
        }

        std::cout << "\nTicket Price: ₹" << ticketPrice << "\n";
        std::cout << "Total Weight: " << totalWeight << "\n\n";
    }

    // Get probability table for different number of spins
    void getProbabilityTable(const std::string &targetProduct, int maxSpins = 50)
    {
        std::cout << "=== PROBABILITY TABLE FOR " << targetProduct << " ===\n";
        std::cout << "Spins\tProbability\tCumulative Cost\n";
        std::cout << "-----\t-----------\t---------------\n";

        for (int spins = 1; spins <= maxSpins; spins += 5)
        {
            double prob = getProbabilityOfProductInKSpins(targetProduct, spins);
            int cost = spins * ticketPrice;
            std::cout << spins << "\t" << (prob * 100) << "%\t\t₹" << cost << "\n";
        }
        std::cout << "\n";
    }

    // Calculate profitability analysis
    void calculateProfitability()
    {
        std::cout << "=== PROFITABILITY ANALYSIS ===\n";

        for (const auto &product : products)
        {
            double expectedSpins = getExpectedSpinsForProduct(product.name);
            double expectedCost = expectedSpins * ticketPrice;
            double profit = product.value - expectedCost;
            double profitRatio = profit / expectedCost;

            std::cout << product.name << ":\n";
            std::cout << "  Expected spins: " << expectedSpins << "\n";
            std::cout << "  Expected cost: ₹" << expectedCost << "\n";
            std::cout << "  Product value: ₹" << product.value << "\n";
            std::cout << "  Profit: ₹" << profit << "\n";
            std::cout << "  Profit ratio: " << (profitRatio * 100) << "%\n\n";
        }
    }
};

// Main function demonstrating the algorithm
int main()
{
    // Your product data
    std::vector<std::pair<std::string, int>> appleProducts = {
        {"iPhone", 10}, {"iPad", 50}, {"MacBook", 200}, {"AirPods", 1000}};

    int ticketPrice = 100;

    // Create calculator
    WeightedProbabilityCalculator calculator(appleProducts, ticketPrice);

    std::cout << std::fixed << std::setprecision(4);

    // Display basic probabilities
    calculator.displayProbabilities();

    // Calculate iPhone specific probabilities
    std::string targetProduct = "iPhone";

    std::cout << "=== IPHONE PROBABILITY ANALYSIS ===\n";
    std::cout << "Single spin probability: " << (calculator.getProbabilityOfProduct(targetProduct) * 100) << "%\n";
    std::cout << "Expected spins to get iPhone: " << calculator.getExpectedSpinsForProduct(targetProduct) << "\n";

    // Probability in different number of spins
    for (int spins = 1; spins <= 20; spins += 3)
    {
        double prob = calculator.getProbabilityOfProductInKSpins(targetProduct, spins);
        std::cout << "Probability in " << spins << " spins: " << (prob * 100) << "%\n";
    }

    std::cout << "\n=== ALL PRODUCTS PROBABILITY ANALYSIS ===\n";
    std::cout << "Expected spins to get ALL products: " << calculator.getExpectedSpinsForAllProducts() << "\n";

    // Probability of getting all products in different number of spins
    for (int spins = 10; spins <= 100; spins += 20)
    {
        double prob = calculator.getProbabilityOfAllProducts(spins);
        std::cout << "Probability of ALL products in " << spins << " spins: " << (prob * 100) << "%\n";
    }

    // Show probability table
    calculator.getProbabilityTable("iPhone", 30);

    // Profitability analysis
    calculator.calculateProfitability();

    return 0;
}

// Additional utility class for website integration
class WebsiteSpinCalculator
{
public:
    static std::pair<double, double> calculateProbabilities(
        const std::vector<std::pair<std::string, int>> &products,
        const std::string &targetProduct,
        int ticketPrice,
        int numberOfSpins)
    {
        WeightedProbabilityCalculator calc(products, ticketPrice);

        double targetProbability = calc.getProbabilityOfProductInKSpins(targetProduct, numberOfSpins);
        double allProductsProbability = calc.getProbabilityOfAllProducts(numberOfSpins);

        return {targetProbability, allProductsProbability};
    }

    static int getRecommendedSpins(
        const std::vector<std::pair<std::string, int>> &products,
        const std::string &targetProduct,
        int ticketPrice,
        double targetProbability = 0.8)
    {
        WeightedProbabilityCalculator calc(products, ticketPrice);

        for (int spins = 1; spins <= 1000; spins++)
        {
            double prob = calc.getProbabilityOfProductInKSpins(targetProduct, spins);
            if (prob >= targetProbability)
            {
                return spins;
            }
        }

        return -1; // Target probability not achievable
    }
};
