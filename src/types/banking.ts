/**
 * Banking System Type Definitions
 * Comprehensive TypeScript interfaces for bank accounts, transfers, and related entities
 */

// ============================================================================
// MASTER DATA TYPES
// ============================================================================

/**
 * Bank master record
 * Represents a financial institution in the system
 */
export interface Bank {
  id: string;
  name: string;
  swift_code?: string;
  local_code?: string;
  country_code?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Account type master record
 * Represents different bank account classifications (checking, savings, etc.)
 */
export interface AccountType {
  id: string;
  name: 'checking' | 'savings' | 'moneypocket' | 'debit_card' | string;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Currency reference (imported from general types)
 * Represents supported currencies for transactions
 */
export interface Currency {
  id: string;
  code: string; // 'USD', 'DOP', 'EUR', etc.
  name: string;
  symbol?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// BANK ACCOUNT MANAGEMENT TYPES
// ============================================================================

/**
 * Bank account owned by a user
 * Stores account credentials securely with hashed account numbers
 * Account number is never stored in plain text, only last 4 digits and hash
 */
export interface BankAccount {
  id: string;
  user_id: string;
  bank_id: string;
  account_type_id: string;
  currency_id: string;
  account_number_last4: string; // Display only: "****1234"
  account_number_hash: string; // SHA256(accountNumber + userId)
  account_holder_name: string;
  is_active: boolean;
  deleted_at?: string | null;
  deleted_by_user_id?: string | null;
  created_at: string;
  updated_at: string;

  // Relations (when joined)
  bank?: Bank;
  account_type?: AccountType;
  currency?: Currency;
}

/**
 * Link between recipient and bank account
 * Represents which bank accounts can be used for transfers to a specific recipient
 * Multiple accounts per recipient supported with default preference
 */
export interface RecipientBankAccount {
  id: string;
  recipient_id: string;
  bank_account_id: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // Relations (when joined)
  bank_account?: BankAccount;
  recipient?: Recipient;
}

/**
 * Recipient entity reference
 * Minimal recipient data for type safety
 */
export interface Recipient {
  id: string;
  full_name: string;
  phone?: string;
  email?: string;
  id_number?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// REMITTANCE TRANSFER TYPES
// ============================================================================

/**
 * Bank transfer record for a remittance
 * Tracks the status and details of transferring remittance amount to recipient's bank account
 * Supports audit trail with processed_by_user_id and processed_at timestamps
 */
export interface RemittanceBankTransfer {
  id: string;
  remittance_id: string;
  recipient_bank_account_id: string;
  status: 'pending' | 'confirmed' | 'transferred' | 'failed' | 'reversed';
  processed_by_user_id?: string | null;
  processed_at?: string | null;
  amount_transferred?: number | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;

  // Relations (when joined)
  remittance?: Remittance;
  recipient_bank_account?: RecipientBankAccount;
  processed_by_user?: User;
}

/**
 * Remittance entity reference
 * Minimal remittance data for type safety in transfers
 */
export interface Remittance {
  id: string;
  user_id: string;
  recipient_id: string;
  amount: number;
  currency_id: string;
  amount_to_deliver: number;
  delivery_currency_id: string;
  delivery_method: 'cash' | 'transfer' | 'card' | 'moneypocket';
  status: 'pending' | 'confirmed' | 'completed' | 'failed' | 'cancelled';
  payment_reference?: string;
  payment_proof_url?: string;
  created_at: string;
  updated_at: string;
}

/**
 * User entity reference
 * Minimal user data for type safety in audit trails
 */
export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Standard API response wrapper for all banking operations
 * Ensures consistent error handling and type safety across service calls
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Paginated response for list operations
 * Supports pagination and filtering results
 */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  page_size: number;
  error?: string;
}

// ============================================================================
// REQUEST/FORM DATA TYPES
// ============================================================================

/**
 * Bank account creation request
 * Form data for creating new bank account
 */
export interface CreateBankAccountRequest {
  bankId: string;
  accountTypeId: string;
  currencyId: string;
  accountNumber: string; // Will be hashed and stored
  accountHolderName: string;
}

/**
 * Bank account update request
 * Supports partial updates to account details
 */
export interface UpdateBankAccountRequest {
  accountHolderName?: string;
  is_active?: boolean;
}

/**
 * Bank transfer creation request
 * Form data for initiating bank transfer for remittance
 */
export interface CreateBankTransferRequest {
  remittanceId: string;
  recipientBankAccountId: string;
  amount_transferred?: number;
}

/**
 * Bank transfer status update request
 * Admin operation to update transfer status with optional metadata
 */
export interface UpdateBankTransferStatusRequest {
  status: 'pending' | 'confirmed' | 'transferred' | 'failed' | 'reversed';
  processedByUserId?: string;
  processedAt?: string;
  amountTransferred?: number;
  errorMessage?: string;
}

// ============================================================================
// AGGREGATE/COMPOSED TYPES
// ============================================================================

/**
 * Complete bank account details with all relations
 * Used for display and form pre-population
 */
export interface BankAccountDetail extends BankAccount {
  bank: Bank;
  account_type: AccountType;
  currency: Currency;
}

/**
 * Complete bank transfer record with all relations
 * Used for admin dashboard and audit views
 */
export interface RemittanceBankTransferDetail extends RemittanceBankTransfer {
  remittance: Remittance;
  recipient_bank_account: RecipientBankAccount & { bank_account: BankAccountDetail };
  processed_by_user?: User;
}

/**
 * Recipient bank account info for recipient profile
 * Shows all linked accounts with bank details
 */
export interface RecipientBankAccountWithDetails extends RecipientBankAccount {
  bank_account: BankAccountDetail;
}

// ============================================================================
// FILTER/QUERY TYPES
// ============================================================================

/**
 * Filters for querying bank transfers
 */
export interface BankTransferFilters {
  remittanceId?: string;
  recipientId?: string;
  status?: RemittanceBankTransfer['status'];
  startDate?: string;
  endDate?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Filters for querying bank accounts
 */
export interface BankAccountFilters {
  userId?: string;
  bankId?: string;
  accountTypeId?: string;
  currencyId?: string;
  isActive?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================================================
// ENUM-LIKE TYPES
// ============================================================================

/**
 * Valid bank transfer statuses
 * Represents progression of bank transfer through system lifecycle
 */
export type BankTransferStatus = 'pending' | 'confirmed' | 'transferred' | 'failed' | 'reversed';

/**
 * Valid account types
 * Represents classification of bank accounts
 */
export type AccountTypeName = 'checking' | 'savings' | 'moneypocket' | 'debit_card';

/**
 * Valid delivery methods for remittances
 */
export type RemittanceDeliveryMethod = 'cash' | 'transfer' | 'card' | 'moneypocket';

/**
 * Valid remittance statuses
 */
export type RemittanceStatus = 'pending' | 'confirmed' | 'completed' | 'failed' | 'cancelled';
