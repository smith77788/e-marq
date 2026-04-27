/**
 * Public tracking snippet endpoint.
 *
 * GET /track/{slug}.js
 *   → returns a tiny JS snippet the brand owner pastes on their site.
 *
 * The snippet:
 *   - Generates/persists a session_id in localStorage.
 *   - Auto-fires `page_view` (mapped to product_viewed if URL has /products/).
 *   - Exposes `window.ACOS.track(eventType, payload)` for manual events:
 *       ACOS.track('add_to_cart',     { product_id, price_cents, name });
 *       ACOS.track('checkout_started',{ cart_value_cents, product_names, email });
 *       ACOS.track('purchase_completed', { order_id, total_cents, email });
 *   - Posts to /hooks/ingest with tenant slug.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/track/$slug.js")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const slug = params.slug;
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id, slug, status")
          .eq("slug", slug)
          .maybeSingle();
        if (!tenant || tenant.status !== "active") {
          return new Response("// ACOS: unknown or inactive tenant\n", {
            status: 404,
            headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" },
          });
        }
        const origin = new URL(request.url).origin;
        const js = `(function(){
  var TENANT='${tenant.slug}';
  var INGEST='${origin}/hooks/ingest';
  function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});}
  var sid;
  try{sid=localStorage.getItem('acos_sid');if(!sid){sid=uuid();localStorage.setItem('acos_sid',sid);}}catch(e){sid=uuid();}
  function send(type,payload){
    payload=payload||{};
    var body={tenant_slug:TENANT,session_id:sid,type:type,payload:payload,url:location.href,referrer:document.referrer||null};
    try{
      if(navigator.sendBeacon){navigator.sendBeacon(INGEST,new Blob([JSON.stringify(body)],{type:'application/json'}));}
      else{fetch(INGEST,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(function(){});}
    }catch(e){}
  }
  // Auto-detect product page
  var initialType='content_viewed';
  if(/\\/(products?|p|item)\\//i.test(location.pathname))initialType='product_viewed';
  send(initialType,{title:document.title});
  var api={track:send,sid:sid,tenant:TENANT};
  window.MARQ=api;
  window.ACOS=api; // legacy alias — kept for backward compatibility
})();`;
        return new Response(js, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
