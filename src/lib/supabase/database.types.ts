// ─────────────────────────────────────────────────────────────
// Tipos do banco (schema gestor360) no formato do `supabase gen types`.
//
// Derivados das migrations em supabase/migrations (0001 → 0011). Com
// acesso direto ao Postgres, regenere com:
//   npx supabase gen types typescript --db-url "$DATABASE_URL" --schema gestor360 \
//     > src/lib/supabase/database.types.ts
// Ao criar uma migration nova, atualize este arquivo no mesmo commit —
// o typecheck do CI pega qualquer query que use coluna inexistente.
// ─────────────────────────────────────────────────────────────

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string };

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  gestor360: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          display_name: string | null;
          monthly_income: number;
          employment_type: "clt" | "autonomo" | "misto";
          dependents: number;
          priority_ladder: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          display_name?: string | null;
          monthly_income?: number;
          employment_type?: "clt" | "autonomo" | "misto";
          dependents?: number;
          priority_ladder?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      accounts: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          name: string;
          kind: "corrente" | "poupanca" | "carteira" | "investimento" | "cartao";
          opening_balance: number;
          pluggy_account_id: string | null;
          pluggy_item_id: string | null;
          current_balance: number | null;
          account_type: "bank" | "credit" | "investment" | null;
          institution: string | null;
          credit_limit: number | null;
          credit_available: number | null;
          credit_minimum_payment: number | null;
          credit_due_date: string | null;
          card_brand: string | null;
          card_last4: string | null;
          number: string | null;
          owner: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          kind?: "corrente" | "poupanca" | "carteira" | "investimento" | "cartao";
          opening_balance?: number;
          pluggy_account_id?: string | null;
          pluggy_item_id?: string | null;
          current_balance?: number | null;
          account_type?: "bank" | "credit" | "investment" | null;
          institution?: string | null;
          credit_limit?: number | null;
          credit_available?: number | null;
          credit_minimum_payment?: number | null;
          credit_due_date?: string | null;
          card_brand?: string | null;
          card_last4?: string | null;
          number?: string | null;
          owner?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["accounts"]["Insert"]>;
        Relationships: [];
      };
      categories: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          name: string;
          kind: "receita" | "despesa";
          nature: "fixa" | "variavel" | "discricionaria" | "receita";
          color: string;
          is_system: boolean;
          parent_id: string | null;
          sort_order: number;
          code: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          kind?: "receita" | "despesa";
          nature?: "fixa" | "variavel" | "discricionaria" | "receita";
          color?: string;
          is_system?: boolean;
          parent_id?: string | null;
          sort_order?: number;
          code?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["categories"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      category_rules: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          pattern: string;
          category_id: string;
          source: "manual" | "learned";
        };
        Insert: {
          id?: string;
          user_id: string;
          pattern: string;
          category_id: string;
          source?: "manual" | "learned";
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["category_rules"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "category_rules_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      transactions: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          date: string;
          amount: number;
          type: "entrada" | "saida";
          description: string;
          raw_description: string;
          category_id: string | null;
          account_id: string | null;
          origin: "manual" | "import" | "open_finance";
          is_duplicate: boolean;
          needs_review: boolean;
          external_id: string | null;
          payee_id: string | null;
          payment_method: "pix" | "credito" | "debito" | "boleto" | "transferencia" | null;
          raw_payload: Json | null;
          operation_type: string | null;
          counterparty_document: string | null;
          counterparty_name: string | null;
          merchant_name: string | null;
          pluggy_category: string | null;
          pluggy_category_id: string | null;
          status: "POSTED" | "PENDING" | null;
          has_credit_card: boolean | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          amount: number;
          type: "entrada" | "saida";
          description: string;
          raw_description?: string;
          category_id?: string | null;
          account_id?: string | null;
          origin?: "manual" | "import" | "open_finance";
          is_duplicate?: boolean;
          needs_review?: boolean;
          external_id?: string | null;
          payee_id?: string | null;
          payment_method?: "pix" | "credito" | "debito" | "boleto" | "transferencia" | null;
          raw_payload?: Json | null;
          operation_type?: string | null;
          counterparty_document?: string | null;
          counterparty_name?: string | null;
          merchant_name?: string | null;
          pluggy_category?: string | null;
          pluggy_category_id?: string | null;
          status?: "POSTED" | "PENDING" | null;
          has_credit_card?: boolean | null;
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["transactions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_payee_id_fkey";
            columns: ["payee_id"];
            isOneToOne: false;
            referencedRelation: "payees";
            referencedColumns: ["id"];
          },
        ];
      };
      budgets: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          category_id: string;
          monthly_limit: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          category_id: string;
          monthly_limit: number;
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["budgets"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          name: string;
          target_amount: number;
          current_amount: number;
          deadline: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          target_amount: number;
          current_amount?: number;
          deadline?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["goals"]["Insert"]>;
        Relationships: [];
      };
      pluggy_items: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          item_id: string;
          connector_name: string | null;
          status: string | null;
          consent_expires_at: string | null;
          last_synced_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          item_id: string;
          connector_name?: string | null;
          status?: string | null;
          consent_expires_at?: string | null;
          last_synced_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["pluggy_items"]["Insert"]>;
        Relationships: [];
      };
      pluggy_webhook_events: {
        Row: {
          id: string;
          event_id: string;
          event: string;
          item_id: string | null;
          payload: Json;
          received_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          event: string;
          item_id?: string | null;
          payload?: Json;
          received_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["pluggy_webhook_events"]["Insert"]>;
        Relationships: [];
      };
      payees: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          name: string;
          normalized_name: string;
          document_number: string | null;
          kind: "pessoa" | "empresa" | "estabelecimento" | "desconhecido";
          first_seen: string | null;
          last_seen: string | null;
          tx_count: number;
          total_paid: number;
          total_received: number;
          default_category_id: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          normalized_name: string;
          document_number?: string | null;
          kind?: "pessoa" | "empresa" | "estabelecimento" | "desconhecido";
          first_seen?: string | null;
          last_seen?: string | null;
          tx_count?: number;
          total_paid?: number;
          total_received?: number;
          default_category_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["payees"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "payees_default_category_id_fkey";
            columns: ["default_category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_credentials: {
        Row: Timestamps & {
          id: string;
          user_id: string;
          provider: "anthropic" | "openai" | "gemini" | "deepseek" | "typesafe";
          /** Cifrada em repouso (AES-256-GCM, prefixo "enc:v1:") — ver src/lib/security/secret-box.ts. */
          api_key: string;
          model: string | null;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: "anthropic" | "openai" | "gemini" | "deepseek" | "typesafe";
          api_key: string;
          model?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["gestor360"]["Tables"]["ai_credentials"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      bootstrap_user: {
        Args: { p_display_name?: string | null };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type Schema = Database["gestor360"];

/** Linha de uma tabela, ex: `Tables<"transactions">`. */
export type Tables<T extends keyof Schema["Tables"]> = Schema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Schema["Tables"]> = Schema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Schema["Tables"]> = Schema["Tables"][T]["Update"];

/** Cliente Supabase tipado para o schema gestor360 (servidor, admin ou navegador). */
export type DbClient = import("@supabase/supabase-js").SupabaseClient<Database, "gestor360">;
