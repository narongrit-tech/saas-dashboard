/**
 * Wallet Balance Calculation Utility
 *
 * Server-side utility for calculating wallet balance over a date range.
 * Used for displaying wallet balance summary cards.
 *
 * Business Logic:
 * - Opening Balance = Sum of all entries before start date
 * - Total IN = Sum of IN entries in date range
 * - Total OUT = Sum of OUT entries in date range
 * - Net Change = Total IN - Total OUT
 * - Closing Balance = Opening Balance + Net Change
 */

import { createClient } from '@/lib/supabase/server'
import { WalletBalance, WalletLedger } from '@/types/wallets'

interface CalculateBalanceParams {
  walletId: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

/**
 * Calculate wallet balance for a specific date range
 * @param walletId - UUID of the wallet
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns WalletBalance object with breakdown
 */
export async function calculateWalletBalance({
  walletId,
  startDate,
  endDate,
}: CalculateBalanceParams): Promise<WalletBalance | null> {
  try {
    const supabase = createClient()

    // 1. Get wallet info
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, name')
      .eq('id', walletId)
      .single()

    if (walletError || !wallet) {
      console.error('Error fetching wallet:', walletError)
      return null
    }

    // 2. Get opening balance (all entries before start date)
    const { data: openingEntries, error: openingError } = await supabase
      .from('wallet_ledger')
      .select('direction, amount')
      .eq('wallet_id', walletId)
      .lt('date', startDate)

    if (openingError) {
      console.error('Error fetching opening balance:', openingError)
      return null
    }

    const openingBalance = (openingEntries || []).reduce((sum, entry) => {
      return entry.direction === 'IN' ? sum + Number(entry.amount) : sum - Number(entry.amount)
    }, 0)

    // 3. Get entries within date range
    const { data: rangeEntries, error: rangeError } = await supabase
      .from('wallet_ledger')
      .select('*')
      .eq('wallet_id', walletId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (rangeError) {
      console.error('Error fetching range entries:', rangeError)
      return null
    }

    // 4. Calculate totals for the range
    const entries = (rangeEntries || []) as WalletLedger[]

    let totalIn = 0
    let totalOut = 0
    let topUpTotal = 0
    let spendTotal = 0
    let refundTotal = 0
    let adjustmentIn = 0
    let adjustmentOut = 0

    entries.forEach((entry) => {
      const amount = Number(entry.amount)

      if (entry.direction === 'IN') {
        totalIn += amount

        switch (entry.entry_type) {
          case 'TOP_UP':
            topUpTotal += amount
            break
          case 'REFUND':
            refundTotal += amount
            break
          case 'ADJUSTMENT':
            adjustmentIn += amount
            break
        }
      } else {
        // direction === 'OUT'
        totalOut += amount

        switch (entry.entry_type) {
          case 'SPEND':
            spendTotal += amount
            break
          case 'ADJUSTMENT':
            adjustmentOut += amount
            break
        }
      }
    })

    const netChange = totalIn - totalOut
    const closingBalance = openingBalance + netChange

    return {
      wallet_id: walletId,
      wallet_name: wallet.name,
      opening_balance: Math.round(openingBalance * 100) / 100,
      total_in: Math.round(totalIn * 100) / 100,
      total_out: Math.round(totalOut * 100) / 100,
      net_change: Math.round(netChange * 100) / 100,
      closing_balance: Math.round(closingBalance * 100) / 100,
      top_up_total: Math.round(topUpTotal * 100) / 100,
      spend_total: Math.round(spendTotal * 100) / 100,
      refund_total: Math.round(refundTotal * 100) / 100,
      adjustment_in: Math.round(adjustmentIn * 100) / 100,
      adjustment_out: Math.round(adjustmentOut * 100) / 100,
    }
  } catch (error) {
    console.error('Unexpected error calculating wallet balance:', error)
    return null
  }
}

/**
 * Get current balance for a wallet (up to today)
 * @param walletId - UUID of the wallet
 * @returns Current balance number
 */
export async function getCurrentWalletBalance(walletId: string): Promise<number> {
  try {
    const supabase = createClient()

    // Get all entries up to today
    const { data: entries, error } = await supabase
      .from('wallet_ledger')
      .select('direction, amount')
      .eq('wallet_id', walletId)

    if (error) {
      console.error('Error fetching current balance:', error)
      return 0
    }

    const balance = (entries || []).reduce((sum, entry) => {
      return entry.direction === 'IN'
        ? sum + Number(entry.amount)
        : sum - Number(entry.amount)
    }, 0)

    return Math.round(balance * 100) / 100
  } catch (error) {
    console.error('Unexpected error getting current balance:', error)
    return 0
  }
}
