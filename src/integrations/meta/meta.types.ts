export interface MetaLeadgenEvent {
  leadgenId: string;
  pageId: string;
  formId?: string;
  adId?: string;
  adsetId?: string;
  campaignId?: string;
  createdTime?: number;
}

export interface MetaLeadField {
  name: string;
  values?: string[];
}

export interface MetaLeadDetails {
  id: string;
  created_time?: string;
  field_data?: MetaLeadField[];
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
  page_id?: string;
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: {
        leadgen_id?: string;
        page_id?: string;
        form_id?: string;
        ad_id?: string;
        adset_id?: string;
        campaign_id?: string;
        created_time?: number;
      };
    }>;
  }>;
}
