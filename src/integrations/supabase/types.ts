export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      acos_agent_runs: {
        Row: {
          agent_id: string
          error: string | null
          finished_at: string | null
          id: string
          insights_created: number
          metadata: Json
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          agent_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          insights_created?: number
          metadata?: Json
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          agent_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          insights_created?: number
          metadata?: Json
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acos_agent_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_actions: {
        Row: {
          action_type: string
          actual_result: Json
          agent_id: string
          applied_at: string | null
          created_at: string
          expected_impact: string | null
          id: string
          measured_at: string | null
          parameters: Json
          reverted_at: string | null
          reverted_reason: string | null
          source_insight_id: string | null
          status: string
          target_entity: string | null
          target_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_type: string
          actual_result?: Json
          agent_id: string
          applied_at?: string | null
          created_at?: string
          expected_impact?: string | null
          id?: string
          measured_at?: string | null
          parameters?: Json
          reverted_at?: string | null
          reverted_reason?: string | null
          source_insight_id?: string | null
          status?: string
          target_entity?: string | null
          target_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          actual_result?: Json
          agent_id?: string
          applied_at?: string | null
          created_at?: string
          expected_impact?: string | null
          id?: string
          measured_at?: string | null
          parameters?: Json
          reverted_at?: string | null
          reverted_reason?: string | null
          source_insight_id?: string | null
          status?: string
          target_entity?: string | null
          target_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_actions_source_insight_id_fkey"
            columns: ["source_insight_id"]
            isOneToOne: false
            referencedRelation: "ai_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          affected_layer: string | null
          confidence: number
          created_at: string
          dedup_bucket: number | null
          description: string
          expected_impact: string | null
          id: string
          insight_type: string
          metrics: Json
          risk_level: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_layer?: string | null
          confidence?: number
          created_at?: string
          dedup_bucket?: number | null
          description?: string
          expected_impact?: string | null
          id?: string
          insight_type: string
          metrics?: Json
          risk_level?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_layer?: string | null
          confidence?: number
          created_at?: string
          dedup_bucket?: number | null
          description?: string
          expected_impact?: string | null
          id?: string
          insight_type?: string
          metrics?: Json
          risk_level?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_memory: {
        Row: {
          agent: string
          avg_impact: number
          category: string
          confidence: number
          created_at: string
          evidence: Json
          failure_count: number
          id: string
          is_active: boolean
          last_observed_at: string
          learned_rule: string
          pattern_key: string
          success_count: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent: string
          avg_impact?: number
          category: string
          confidence?: number
          created_at?: string
          evidence?: Json
          failure_count?: number
          id?: string
          is_active?: boolean
          last_observed_at?: string
          learned_rule?: string
          pattern_key: string
          success_count?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent?: string
          avg_impact?: number
          category?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          failure_count?: number
          id?: string
          is_active?: boolean
          last_observed_at?: string
          learned_rule?: string
          pattern_key?: string
          success_count?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          body: string
          channel: string
          created_at: string
          customer_id: string | null
          direction: string
          external_thread_id: string | null
          id: string
          intent: string | null
          metadata: Json
          tenant_id: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          customer_id?: string | null
          direction: string
          external_thread_id?: string | null
          id?: string
          intent?: string | null
          metadata?: Json
          tenant_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          customer_id?: string | null
          direction?: string
          external_thread_id?: string | null
          id?: string
          intent?: string | null
          metadata?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          avg_cycle_days: number | null
          avg_order_cents: number
          consent_marketing: boolean
          created_at: string
          email: string | null
          first_order_at: string | null
          id: string
          last_contacted_at: string | null
          last_order_at: string | null
          lifecycle_stage: string
          metadata: Json
          name: string | null
          predicted_next_order_at: string | null
          telegram_chat_id: string | null
          telegram_username: string | null
          tenant_id: string
          total_orders: number
          total_spent_cents: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avg_cycle_days?: number | null
          avg_order_cents?: number
          consent_marketing?: boolean
          created_at?: string
          email?: string | null
          first_order_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_order_at?: string | null
          lifecycle_stage?: string
          metadata?: Json
          name?: string | null
          predicted_next_order_at?: string | null
          telegram_chat_id?: string | null
          telegram_username?: string | null
          tenant_id: string
          total_orders?: number
          total_spent_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avg_cycle_days?: number | null
          avg_order_cents?: number
          consent_marketing?: boolean
          created_at?: string
          email?: string | null
          first_order_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_order_at?: string | null
          lifecycle_stage?: string
          metadata?: Json
          name?: string | null
          predicted_next_order_at?: string | null
          telegram_chat_id?: string | null
          telegram_username?: string | null
          tenant_id?: string
          total_orders?: number
          total_spent_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_policies: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          policy_key: string
          reason: string | null
          tenant_id: string
          total_revenue_cents: number
          trial_count: number
          updated_at: string
          value: Json
          win_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          policy_key: string
          reason?: string | null
          tenant_id: string
          total_revenue_cents?: number
          trial_count?: number
          updated_at?: string
          value: Json
          win_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          policy_key?: string
          reason?: string | null
          tenant_id?: string
          total_revenue_cents?: number
          trial_count?: number
          updated_at?: string
          value?: Json
          win_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "decision_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          payload: Json
          product_id: string | null
          session_id: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["event_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          payload?: Json
          product_id?: string | null
          session_id?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["event_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          payload?: Json
          product_id?: string | null
          session_id?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["event_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          tenant_id: string
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          tenant_id: string
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          tenant_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_user_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_method?: string
          payment_ref?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_user_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_method?: string
          payment_ref?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          actual_revenue_cents: number | null
          body: string
          channel: string
          channel_message_id: string | null
          converted_at: string | null
          created_at: string
          customer_id: string | null
          error: string | null
          expected_impact_cents: number | null
          id: string
          metadata: Json
          related_product_id: string | null
          replied_at: string | null
          scheduled_for: string
          sent_at: string | null
          source_action_id: string | null
          source_insight_id: string | null
          status: string
          template_key: string | null
          tenant_id: string
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          actual_revenue_cents?: number | null
          body: string
          channel: string
          channel_message_id?: string | null
          converted_at?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          expected_impact_cents?: number | null
          id?: string
          metadata?: Json
          related_product_id?: string | null
          replied_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          source_action_id?: string | null
          source_insight_id?: string | null
          status?: string
          template_key?: string | null
          tenant_id: string
          trigger_kind: string
          updated_at?: string
        }
        Update: {
          actual_revenue_cents?: number | null
          body?: string
          channel?: string
          channel_message_id?: string | null
          converted_at?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          expected_impact_cents?: number | null
          id?: string
          metadata?: Json
          related_product_id?: string | null
          replied_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          source_action_id?: string | null
          source_insight_id?: string | null
          status?: string
          template_key?: string | null
          tenant_id?: string
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          metadata: Json
          name: string
          price_cents: number
          sku: string | null
          stock: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          name: string
          price_cents?: number
          sku?: string | null
          stock?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          metadata?: Json
          name?: string
          price_cents?: number
          sku?: string | null
          stock?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_chat_routing: {
        Row: {
          chat_id: string
          created_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_chat_routing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_configs: {
        Row: {
          bot: Json
          brand_name: string
          created_at: string
          features: Json
          seo: Json
          tenant_id: string
          ui: Json
          updated_at: string
        }
        Insert: {
          bot?: Json
          brand_name: string
          created_at?: string
          features?: Json
          seo?: Json
          tenant_id: string
          ui?: Json
          updated_at?: string
        }
        Update: {
          bot?: Json
          brand_name?: string
          created_at?: string
          features?: Json
          seo?: Json
          tenant_id?: string
          ui?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_order: {
        Args: { _order_id: string }
        Returns: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_public_order: { Args: { _order_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { _tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      mark_order_paid: {
        Args: { _order_id: string; _payment_ref?: string }
        Returns: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_user_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          payment_ref: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "super_admin"
      event_type:
        | "product_viewed"
        | "add_to_cart"
        | "checkout_started"
        | "purchase_completed"
        | "reorder_clicked"
        | "bot_interaction"
        | "content_viewed"
        | "inactivity_detected"
        | "message_sent"
        | "message_received"
        | "session_start"
        | "reorder_triggered"
      order_status: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded"
      tenant_role: "owner" | "admin" | "member"
      tenant_status: "active" | "suspended" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin"],
      event_type: [
        "product_viewed",
        "add_to_cart",
        "checkout_started",
        "purchase_completed",
        "reorder_clicked",
        "bot_interaction",
        "content_viewed",
        "inactivity_detected",
        "message_sent",
        "message_received",
        "session_start",
        "reorder_triggered",
      ],
      order_status: ["pending", "paid", "fulfilled", "cancelled", "refunded"],
      tenant_role: ["owner", "admin", "member"],
      tenant_status: ["active", "suspended", "archived"],
    },
  },
} as const
