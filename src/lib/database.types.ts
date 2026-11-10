
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "garments": {
                  Row: {
                    "category": Database["public"]['Enums']["garment_category"] | null,"colors": (Database["public"]['Enums']["garment_color"])[],"created_at": string,"extraction_status": Database["public"]['Enums']["extraction_status"],"fit": Database["public"]['Enums']["garment_fit"] | null,"formality": number | null,"id": string,"last_worn_at": string | null,"material": Database["public"]['Enums']["garment_material"] | null,"occasions": (Database["public"]['Enums']["occasion"])[],"pattern": Database["public"]['Enums']["garment_pattern"] | null,"photo_version": number,"reviewed_at": string | null,"seasons": (Database["public"]['Enums']["season"])[],"status": Database["public"]['Enums']["garment_status"],"uncertain_fields": (Database["public"]['Enums']["garment_field"])[],"updated_at": string,"user_id": string,"warmth": number | null,"wear_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: Database["public"]['Enums']["garment_category"] | null,"colors"?: (Database["public"]['Enums']["garment_color"])[],"created_at"?: string,"extraction_status"?: Database["public"]['Enums']["extraction_status"],"fit"?: Database["public"]['Enums']["garment_fit"] | null,"formality"?: number | null,"id": string,"last_worn_at"?: string | null,"material"?: Database["public"]['Enums']["garment_material"] | null,"occasions"?: (Database["public"]['Enums']["occasion"])[],"pattern"?: Database["public"]['Enums']["garment_pattern"] | null,"photo_version"?: number,"reviewed_at"?: string | null,"seasons"?: (Database["public"]['Enums']["season"])[],"status"?: Database["public"]['Enums']["garment_status"],"uncertain_fields"?: (Database["public"]['Enums']["garment_field"])[],"updated_at"?: string,"user_id"?: string,"warmth"?: number | null,"wear_count"?: number
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["garment_category"] | null,"colors"?: (Database["public"]['Enums']["garment_color"])[],"created_at"?: string,"extraction_status"?: Database["public"]['Enums']["extraction_status"],"fit"?: Database["public"]['Enums']["garment_fit"] | null,"formality"?: number | null,"id"?: string,"last_worn_at"?: string | null,"material"?: Database["public"]['Enums']["garment_material"] | null,"occasions"?: (Database["public"]['Enums']["occasion"])[],"pattern"?: Database["public"]['Enums']["garment_pattern"] | null,"photo_version"?: number,"reviewed_at"?: string | null,"seasons"?: (Database["public"]['Enums']["season"])[],"status"?: Database["public"]['Enums']["garment_status"],"uncertain_fields"?: (Database["public"]['Enums']["garment_field"])[],"updated_at"?: string,"user_id"?: string,"warmth"?: number | null,"wear_count"?: number
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "age_group": Database["public"]['Enums']["age_group"] | null,"body_type": Database["public"]['Enums']["body_type"] | null,"bottom_size": string | null,"chest_cm": number | null,"city_lat": number | null,"city_lon": number | null,"city_name": string | null,"clothing_type": Database["public"]['Enums']["clothing_type"] | null,"created_at": string,"height_cm": number | null,"hips_cm": number | null,"language": Database["public"]['Enums']["app_language"] | null,"occasions": (Database["public"]['Enums']["occasion"])[],"onboarding_completed_at": string | null,"shoe_size": string | null,"styles": (Database["public"]['Enums']["style"])[],"top_size": string | null,"updated_at": string,"user_id": string,"waist_cm": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "age_group"?: Database["public"]['Enums']["age_group"] | null,"body_type"?: Database["public"]['Enums']["body_type"] | null,"bottom_size"?: string | null,"chest_cm"?: number | null,"city_lat"?: number | null,"city_lon"?: number | null,"city_name"?: string | null,"clothing_type"?: Database["public"]['Enums']["clothing_type"] | null,"created_at"?: string,"height_cm"?: number | null,"hips_cm"?: number | null,"language"?: Database["public"]['Enums']["app_language"] | null,"occasions"?: (Database["public"]['Enums']["occasion"])[],"onboarding_completed_at"?: string | null,"shoe_size"?: string | null,"styles"?: (Database["public"]['Enums']["style"])[],"top_size"?: string | null,"updated_at"?: string,"user_id": string,"waist_cm"?: number | null
                  }
                  Update: {
                    "age_group"?: Database["public"]['Enums']["age_group"] | null,"body_type"?: Database["public"]['Enums']["body_type"] | null,"bottom_size"?: string | null,"chest_cm"?: number | null,"city_lat"?: number | null,"city_lon"?: number | null,"city_name"?: string | null,"clothing_type"?: Database["public"]['Enums']["clothing_type"] | null,"created_at"?: string,"height_cm"?: number | null,"hips_cm"?: number | null,"language"?: Database["public"]['Enums']["app_language"] | null,"occasions"?: (Database["public"]['Enums']["occasion"])[],"onboarding_completed_at"?: string | null,"shoe_size"?: string | null,"styles"?: (Database["public"]['Enums']["style"])[],"top_size"?: string | null,"updated_at"?: string,"user_id"?: string,"waist_cm"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"usage_counters": {
                  Row: {
                    "count": number,"day": string,"kind": Database["public"]['Enums']["quota_kind"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"day": string,"kind": Database["public"]['Enums']["quota_kind"],"user_id": string
                  }
                  Update: {
                    "count"?: number,"day"?: string,"kind"?: Database["public"]['Enums']["quota_kind"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "consume_quota":
{ Args: { "p_kind": Database["public"]['Enums']["quota_kind"],"p_limit": number,"p_user_id": string }; Returns: boolean
                           }
          }
          Enums: {
            "age_group": "under_18"|"18_24"|"25_34"|"35_44"|"45_54"|"55_plus","app_language": "en"|"es","body_type": "hourglass"|"pear"|"apple"|"rectangle"|"inverted_triangle"|"trapezoid"|"triangle"|"oval","clothing_type": "feminine"|"masculine"|"everything","extraction_status": "pending"|"done"|"failed"|"over_quota","garment_category": "t_shirt"|"blouse"|"shirt"|"polo"|"tank_top"|"sweater"|"hoodie"|"cardigan"|"pants"|"jeans"|"shorts"|"skirt"|"leggings"|"dress"|"jumpsuit"|"jacket"|"blazer"|"coat"|"vest"|"sneakers"|"shoes"|"heels"|"flats"|"sandals"|"boots"|"loafers"|"bag"|"hat"|"belt"|"scarf"|"tie"|"jewelry"|"sunglasses"|"watch"|"accessory","garment_color": "black"|"white"|"gray"|"navy"|"blue"|"light_blue"|"red"|"burgundy"|"pink"|"purple"|"green"|"olive"|"yellow"|"orange"|"brown"|"camel"|"beige"|"cream"|"gold"|"silver","garment_field": "category"|"colors"|"pattern"|"material"|"formality"|"seasons"|"warmth"|"fit"|"occasions","garment_fit": "fitted"|"regular"|"loose"|"oversized","garment_material": "cotton"|"denim"|"wool"|"knit"|"leather"|"synthetic"|"silk"|"linen"|"other","garment_pattern": "solid"|"striped"|"checked"|"floral"|"polka_dot"|"animal_print"|"geometric"|"graphic"|"other","garment_status": "available"|"laundry"|"lent","occasion": "office"|"university"|"going_out"|"home"|"event"|"sport","quota_kind": "extraction","season": "spring"|"summer"|"autumn"|"winter","style": "casual"|"elegant"|"minimalist"|"sporty"|"urban"|"bohemian"|"classic"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "age_group": ["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"],"app_language": ["en", "es"],"body_type": ["hourglass", "pear", "apple", "rectangle", "inverted_triangle", "trapezoid", "triangle", "oval"],"clothing_type": ["feminine", "masculine", "everything"],"extraction_status": ["pending", "done", "failed", "over_quota"],"garment_category": ["t_shirt", "blouse", "shirt", "polo", "tank_top", "sweater", "hoodie", "cardigan", "pants", "jeans", "shorts", "skirt", "leggings", "dress", "jumpsuit", "jacket", "blazer", "coat", "vest", "sneakers", "shoes", "heels", "flats", "sandals", "boots", "loafers", "bag", "hat", "belt", "scarf", "tie", "jewelry", "sunglasses", "watch", "accessory"],"garment_color": ["black", "white", "gray", "navy", "blue", "light_blue", "red", "burgundy", "pink", "purple", "green", "olive", "yellow", "orange", "brown", "camel", "beige", "cream", "gold", "silver"],"garment_field": ["category", "colors", "pattern", "material", "formality", "seasons", "warmth", "fit", "occasions"],"garment_fit": ["fitted", "regular", "loose", "oversized"],"garment_material": ["cotton", "denim", "wool", "knit", "leather", "synthetic", "silk", "linen", "other"],"garment_pattern": ["solid", "striped", "checked", "floral", "polka_dot", "animal_print", "geometric", "graphic", "other"],"garment_status": ["available", "laundry", "lent"],"occasion": ["office", "university", "going_out", "home", "event", "sport"],"quota_kind": ["extraction"],"season": ["spring", "summer", "autumn", "winter"],"style": ["casual", "elegant", "minimalist", "sporty", "urban", "bohemian", "classic"]
          }
        }
} as const
