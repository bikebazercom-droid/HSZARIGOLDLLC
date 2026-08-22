--
-- PostgreSQL database dump
--

\restrict dHNFcNstMpbmdngfo8iKpTS5pAgRzDbthe9es5iZU7I8jy5XiMn1pbmaDPI8h3a

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    actor_id integer,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    action text NOT NULL,
    bill_no text,
    details text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_settings (
    id integer NOT NULL,
    company_name text DEFAULT 'HAZARI GOLD L.L.C'::text NOT NULL,
    tagline text,
    address text DEFAULT 'Matar Abdul Rahman Khalfan Al Muhairi Building, 1st Floor, Room# 101, Deira, Dubai, UAE'::text NOT NULL,
    phone text DEFAULT '+971 50 536 4193'::text NOT NULL,
    email text DEFAULT 'hazarigoldllc@gmail.com'::text NOT NULL,
    trn text DEFAULT '105301944200003'::text NOT NULL,
    location_url text,
    logo_type text DEFAULT 'monogram'::text NOT NULL,
    logo_initial text DEFAULT 'H'::text NOT NULL,
    logo_image_url text,
    stamp_signature_url text
);


--
-- Name: company_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_settings_id_seq OWNED BY public.company_settings.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    name text NOT NULL,
    mobile text,
    email text,
    passport_number text,
    emirates_id text,
    nationality text,
    address text,
    country text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: inventory_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_consumptions (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    invoice_item_id integer,
    purchase_id integer,
    category text NOT NULL,
    weight_grams numeric(14,4) NOT NULL,
    cost_aed numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_consumptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_consumptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_consumptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_consumptions_id_seq OWNED BY public.inventory_consumptions.id;


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    product_id integer,
    description text NOT NULL,
    category text,
    quantity numeric(12,4) DEFAULT '1'::numeric NOT NULL,
    weight numeric(12,4),
    unit_price numeric(12,4) DEFAULT '0'::numeric NOT NULL,
    total_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    gross_weight numeric(12,4),
    purity text,
    pure_weight numeric(12,4),
    making_rate numeric(12,4),
    making_amt numeric(12,2),
    purity_multiplier numeric(6,4)
);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_number text NOT NULL,
    customer_id integer,
    customer_name text,
    customer_mobile text,
    customer_email text,
    customer_passport_number text,
    customer_emirates_id text,
    payment_method text DEFAULT 'cash'::text NOT NULL,
    subtotal numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    discount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    is_pending boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_nationality text,
    customer_country text,
    metal_rate numeric(12,4),
    place_of_supply text,
    vat_rate numeric(5,2) DEFAULT '5'::numeric NOT NULL,
    vat_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total_before_vat numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total_including_vat numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    round_off_discount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    customer_address text,
    created_by_user_id integer,
    created_by_user_name text
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: pdf_test_fixtures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pdf_test_fixtures (
    id integer NOT NULL,
    run_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pdf_test_fixtures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pdf_test_fixtures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pdf_test_fixtures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pdf_test_fixtures_id_seq OWNED BY public.pdf_test_fixtures.id;


--
-- Name: pdf_test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pdf_test_runs (
    id integer NOT NULL,
    run_id text NOT NULL,
    owner_user_id integer,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pdf_test_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pdf_test_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pdf_test_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pdf_test_runs_id_seq OWNED BY public.pdf_test_runs.id;


--
-- Name: price_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_items (
    id integer NOT NULL,
    name text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    formula_type text DEFAULT 'spot_per_gram'::text NOT NULL,
    weight_grams numeric(14,6),
    weight_label text DEFAULT '1GM'::text NOT NULL,
    purity_factor numeric(10,7) DEFAULT 1.0 NOT NULL,
    premium_offset_aed numeric(12,4) DEFAULT '0'::numeric NOT NULL,
    manual_rate_aed numeric(12,4),
    tv_visible boolean DEFAULT true NOT NULL,
    is_core boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_items_id_seq OWNED BY public.price_items.id;


--
-- Name: prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prices (
    id integer NOT NULL,
    gold_price_per_gram numeric(12,4) DEFAULT 320.00 NOT NULL,
    silver_price_per_gram numeric(12,4) DEFAULT 4.50 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gold_jewelry_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    gold_bullion_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    tt_bar_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    kg_bar_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    custom_descriptions text DEFAULT '[]'::text NOT NULL,
    tt_bar_24k_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    gold_22k_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    gold_21k_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    gold_18k_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    gold_9999_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    manual_invoice_mode boolean DEFAULT false NOT NULL,
    gold_kg_9999_rate numeric(12,4) DEFAULT 320.00 NOT NULL,
    singleton_key integer DEFAULT 1 NOT NULL,
    CONSTRAINT prices_singleton_key_check CHECK ((singleton_key = 1))
);


--
-- Name: prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prices_id_seq OWNED BY public.prices.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    unit text DEFAULT 'gram'::text NOT NULL,
    price_per_unit numeric(12,4),
    stock numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: purchase_bill_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_bill_items (
    id integer NOT NULL,
    bill_id integer NOT NULL,
    stock_purchase_id integer,
    category text NOT NULL,
    gross_weight_grams numeric(14,4) NOT NULL,
    purity_percent numeric(7,3) NOT NULL,
    pure_weight_grams numeric(14,4) NOT NULL,
    rate_aed_per_g numeric(14,4) NOT NULL,
    making_charge_aed numeric(14,2) DEFAULT 0 NOT NULL,
    line_total_aed numeric(14,2) NOT NULL
);


--
-- Name: purchase_bill_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_bill_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_bill_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_bill_items_id_seq OWNED BY public.purchase_bill_items.id;


--
-- Name: purchase_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_bills (
    id integer NOT NULL,
    bill_no text NOT NULL,
    bill_date text NOT NULL,
    supplier_name text NOT NULL,
    purchase_type text NOT NULL,
    payment_status text NOT NULL,
    total_gross_grams numeric(14,4) NOT NULL,
    total_pure_grams numeric(14,4) NOT NULL,
    total_aed numeric(14,2) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_phone text,
    supplier_email text,
    supplier_address text
);


--
-- Name: purchase_bills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_bills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_bills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_bills_id_seq OWNED BY public.purchase_bills.id;


--
-- Name: stock_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_levels (
    id integer NOT NULL,
    category text NOT NULL,
    weight_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_levels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_levels_id_seq OWNED BY public.stock_levels.id;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id integer NOT NULL,
    category text NOT NULL,
    type text NOT NULL,
    weight_grams numeric(14,4) NOT NULL,
    ref_type text,
    ref_id integer,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_movements_id_seq OWNED BY public.stock_movements.id;


--
-- Name: stock_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_purchases (
    id integer NOT NULL,
    category text NOT NULL,
    supplier_name text NOT NULL,
    purchase_date text NOT NULL,
    weight_grams numeric(14,4) NOT NULL,
    total_price_aed numeric(14,2) NOT NULL,
    price_per_gram numeric(14,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    remaining_weight_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    narrative text
);


--
-- Name: stock_purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_purchases_id_seq OWNED BY public.stock_purchases.id;


--
-- Name: trader_ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trader_ledger_entries (
    id integer NOT NULL,
    trader_id integer NOT NULL,
    event_type text NOT NULL,
    aed_delta numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    pure_gold_grams_delta numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    wholesale_invoice_id integer,
    wholesale_item_id integer,
    wholesale_settlement_id integer,
    wholesale_return_id integer,
    note text,
    created_by_user_id integer,
    created_by_user_name text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    event_date text DEFAULT (CURRENT_DATE)::text NOT NULL
);


--
-- Name: trader_ledger_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trader_ledger_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trader_ledger_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trader_ledger_entries_id_seq OWNED BY public.trader_ledger_entries.id;


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    mobile text DEFAULT ''::text NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: wholesale_inventory_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_inventory_consumptions (
    id integer NOT NULL,
    wholesale_invoice_id integer NOT NULL,
    wholesale_item_id integer NOT NULL,
    purchase_id integer,
    category text NOT NULL,
    consumed_grams numeric(14,4) NOT NULL,
    cost_aed numeric(14,2) NOT NULL,
    returned_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_shortfall boolean DEFAULT false NOT NULL,
    returned_cogs_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: wholesale_inventory_consumptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_inventory_consumptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_inventory_consumptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_inventory_consumptions_id_seq OWNED BY public.wholesale_inventory_consumptions.id;


--
-- Name: wholesale_invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    quantity numeric(12,4) DEFAULT '1'::numeric NOT NULL,
    gross_grams numeric(14,4) NOT NULL,
    purity_multiplier numeric(6,4) NOT NULL,
    pure_grams numeric(14,4) NOT NULL,
    rate_aed_per_gram numeric(14,4),
    making_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    total_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    fixed_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    returned_gross_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    returned_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    returned_making_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    returned_fixed_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    returned_metal_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: wholesale_invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_invoice_items_id_seq OWNED BY public.wholesale_invoice_items.id;


--
-- Name: wholesale_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_invoices (
    id integer NOT NULL,
    invoice_number text NOT NULL,
    invoice_date text NOT NULL,
    trader_id integer,
    trader_name text NOT NULL,
    trader_phone text,
    trader_email text,
    trader_address text,
    trader_trn text,
    pricing_type text NOT NULL,
    notes text,
    created_by_user_id integer,
    created_by_user_name text,
    status text DEFAULT 'open'::text NOT NULL,
    total_gross_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    total_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    total_making_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    total_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    open_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    settled_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trader_contact_person text,
    payment_mode text
);


--
-- Name: wholesale_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_invoices_id_seq OWNED BY public.wholesale_invoices.id;


--
-- Name: wholesale_return_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_return_lines (
    id integer NOT NULL,
    return_id integer NOT NULL,
    invoice_item_id integer NOT NULL,
    gross_weight_grams numeric(14,4) NOT NULL,
    pure_weight_grams numeric(14,4) NOT NULL,
    returned_making_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    returned_cogs_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    returned_fixed_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    returned_metal_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    returned_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: wholesale_return_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_return_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_return_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_return_lines_id_seq OWNED BY public.wholesale_return_lines.id;


--
-- Name: wholesale_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_returns (
    id integer NOT NULL,
    return_number text NOT NULL,
    invoice_id integer NOT NULL,
    return_date text NOT NULL,
    note text,
    total_returned_gross_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    total_returned_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    created_by_user_id integer,
    created_by_user_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    total_returned_making_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    total_returned_cogs_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    total_returned_fixed_pure_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    total_returned_metal_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL,
    total_returned_aed numeric(14,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: wholesale_returns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_returns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_returns_id_seq OWNED BY public.wholesale_returns.id;


--
-- Name: wholesale_settlement_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_settlement_allocations (
    id integer NOT NULL,
    settlement_id integer NOT NULL,
    invoice_item_id integer NOT NULL,
    pure_weight_grams numeric(14,4) NOT NULL,
    rate_aed_per_gram numeric(14,4) NOT NULL,
    aed_amount numeric(14,2) NOT NULL,
    returned_pure_weight_grams numeric(14,4) DEFAULT '0'::numeric NOT NULL,
    returned_aed_amount numeric(14,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: wholesale_settlement_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_settlement_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_settlement_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_settlement_allocations_id_seq OWNED BY public.wholesale_settlement_allocations.id;


--
-- Name: wholesale_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_settlements (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    settlement_date text NOT NULL,
    pure_weight_grams numeric(14,4) NOT NULL,
    rate_aed_per_gram numeric(14,4) NOT NULL,
    aed_amount numeric(14,2) NOT NULL,
    note text,
    created_by_user_id integer,
    created_by_user_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wholesale_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_settlements_id_seq OWNED BY public.wholesale_settlements.id;


--
-- Name: wholesale_traders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_traders (
    id integer NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    trn text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_person text
);


--
-- Name: wholesale_traders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wholesale_traders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wholesale_traders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wholesale_traders_id_seq OWNED BY public.wholesale_traders.id;


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: company_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings ALTER COLUMN id SET DEFAULT nextval('public.company_settings_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: inventory_consumptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_consumptions ALTER COLUMN id SET DEFAULT nextval('public.inventory_consumptions_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: pdf_test_fixtures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_fixtures ALTER COLUMN id SET DEFAULT nextval('public.pdf_test_fixtures_id_seq'::regclass);


--
-- Name: pdf_test_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_runs ALTER COLUMN id SET DEFAULT nextval('public.pdf_test_runs_id_seq'::regclass);


--
-- Name: price_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_items ALTER COLUMN id SET DEFAULT nextval('public.price_items_id_seq'::regclass);


--
-- Name: prices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prices ALTER COLUMN id SET DEFAULT nextval('public.prices_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: purchase_bill_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_bill_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_bill_items_id_seq'::regclass);


--
-- Name: purchase_bills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_bills ALTER COLUMN id SET DEFAULT nextval('public.purchase_bills_id_seq'::regclass);


--
-- Name: stock_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_levels ALTER COLUMN id SET DEFAULT nextval('public.stock_levels_id_seq'::regclass);


--
-- Name: stock_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements ALTER COLUMN id SET DEFAULT nextval('public.stock_movements_id_seq'::regclass);


--
-- Name: stock_purchases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_purchases ALTER COLUMN id SET DEFAULT nextval('public.stock_purchases_id_seq'::regclass);


--
-- Name: trader_ledger_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries ALTER COLUMN id SET DEFAULT nextval('public.trader_ledger_entries_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: wholesale_inventory_consumptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_inventory_consumptions ALTER COLUMN id SET DEFAULT nextval('public.wholesale_inventory_consumptions_id_seq'::regclass);


--
-- Name: wholesale_invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoice_items ALTER COLUMN id SET DEFAULT nextval('public.wholesale_invoice_items_id_seq'::regclass);


--
-- Name: wholesale_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoices ALTER COLUMN id SET DEFAULT nextval('public.wholesale_invoices_id_seq'::regclass);


--
-- Name: wholesale_return_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_return_lines ALTER COLUMN id SET DEFAULT nextval('public.wholesale_return_lines_id_seq'::regclass);


--
-- Name: wholesale_returns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_returns ALTER COLUMN id SET DEFAULT nextval('public.wholesale_returns_id_seq'::regclass);


--
-- Name: wholesale_settlement_allocations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlement_allocations ALTER COLUMN id SET DEFAULT nextval('public.wholesale_settlement_allocations_id_seq'::regclass);


--
-- Name: wholesale_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlements ALTER COLUMN id SET DEFAULT nextval('public.wholesale_settlements_id_seq'::regclass);


--
-- Name: wholesale_traders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_traders ALTER COLUMN id SET DEFAULT nextval('public.wholesale_traders_id_seq'::regclass);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: inventory_consumptions inventory_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_consumptions
    ADD CONSTRAINT inventory_consumptions_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_unique UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: pdf_test_fixtures pdf_test_fixtures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_fixtures
    ADD CONSTRAINT pdf_test_fixtures_pkey PRIMARY KEY (id);


--
-- Name: pdf_test_runs pdf_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_runs
    ADD CONSTRAINT pdf_test_runs_pkey PRIMARY KEY (id);


--
-- Name: pdf_test_runs pdf_test_runs_run_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_runs
    ADD CONSTRAINT pdf_test_runs_run_id_unique UNIQUE (run_id);


--
-- Name: price_items price_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_items
    ADD CONSTRAINT price_items_pkey PRIMARY KEY (id);


--
-- Name: prices prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prices
    ADD CONSTRAINT prices_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: purchase_bill_items purchase_bill_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_bill_items
    ADD CONSTRAINT purchase_bill_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_bills purchase_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_bills
    ADD CONSTRAINT purchase_bills_pkey PRIMARY KEY (id);


--
-- Name: stock_levels stock_levels_category_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_category_unique UNIQUE (category);


--
-- Name: stock_levels stock_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: stock_purchases stock_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_purchases
    ADD CONSTRAINT stock_purchases_pkey PRIMARY KEY (id);


--
-- Name: trader_ledger_entries trader_ledger_entries_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: trader_ledger_entries trader_ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: trader_ledger_entries trader_ledger_idempotency_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_idempotency_key_uniq UNIQUE (idempotency_key);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (sid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: wholesale_inventory_consumptions wholesale_inventory_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_inventory_consumptions
    ADD CONSTRAINT wholesale_inventory_consumptions_pkey PRIMARY KEY (id);


--
-- Name: wholesale_invoice_items wholesale_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoice_items
    ADD CONSTRAINT wholesale_invoice_items_pkey PRIMARY KEY (id);


--
-- Name: wholesale_invoices wholesale_invoices_invoice_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoices
    ADD CONSTRAINT wholesale_invoices_invoice_number_unique UNIQUE (invoice_number);


--
-- Name: wholesale_invoices wholesale_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoices
    ADD CONSTRAINT wholesale_invoices_pkey PRIMARY KEY (id);


--
-- Name: wholesale_return_lines wholesale_return_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_return_lines
    ADD CONSTRAINT wholesale_return_lines_pkey PRIMARY KEY (id);


--
-- Name: wholesale_returns wholesale_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_returns
    ADD CONSTRAINT wholesale_returns_pkey PRIMARY KEY (id);


--
-- Name: wholesale_returns wholesale_returns_return_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_returns
    ADD CONSTRAINT wholesale_returns_return_number_unique UNIQUE (return_number);


--
-- Name: wholesale_settlement_allocations wholesale_settlement_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlement_allocations
    ADD CONSTRAINT wholesale_settlement_allocations_pkey PRIMARY KEY (id);


--
-- Name: wholesale_settlements wholesale_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlements
    ADD CONSTRAINT wholesale_settlements_pkey PRIMARY KEY (id);


--
-- Name: wholesale_traders wholesale_traders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_traders
    ADD CONSTRAINT wholesale_traders_pkey PRIMARY KEY (id);


--
-- Name: audit_log_created_at_brin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_created_at_brin_idx ON public.audit_log USING brin (created_at);


--
-- Name: pdf_test_fixtures_run_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pdf_test_fixtures_run_entity_idx ON public.pdf_test_fixtures USING btree (run_id, entity_type, entity_id);


--
-- Name: prices_singleton_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prices_singleton_key_unique ON public.prices USING btree (singleton_key);


--
-- Name: trader_ledger_created_brin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trader_ledger_created_brin_idx ON public.trader_ledger_entries USING brin (created_at);


--
-- Name: trader_ledger_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trader_ledger_invoice_idx ON public.trader_ledger_entries USING btree (wholesale_invoice_id);


--
-- Name: trader_ledger_trader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trader_ledger_trader_idx ON public.trader_ledger_entries USING btree (trader_id);


--
-- Name: user_sessions_expire_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_expire_idx ON public.user_sessions USING btree (expire);


--
-- Name: wholesale_invoices_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wholesale_invoices_date_idx ON public.wholesale_invoices USING btree (invoice_date);


--
-- Name: wholesale_invoices_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wholesale_invoices_status_idx ON public.wholesale_invoices USING btree (status);


--
-- Name: wholesale_invoices_trader_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wholesale_invoices_trader_id_idx ON public.wholesale_invoices USING btree (trader_id);


--
-- Name: wholesale_traders_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wholesale_traders_name_idx ON public.wholesale_traders USING btree (name);


--
-- Name: ws_inv_consumptions_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws_inv_consumptions_invoice_idx ON public.wholesale_inventory_consumptions USING btree (wholesale_invoice_id);


--
-- Name: ws_inv_consumptions_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws_inv_consumptions_item_idx ON public.wholesale_inventory_consumptions USING btree (wholesale_item_id);


--
-- Name: ws_settlement_allocations_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws_settlement_allocations_item_idx ON public.wholesale_settlement_allocations USING btree (invoice_item_id);


--
-- Name: ws_settlement_allocations_settlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws_settlement_allocations_settlement_idx ON public.wholesale_settlement_allocations USING btree (settlement_id);


--
-- Name: inventory_consumptions inventory_consumptions_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_consumptions
    ADD CONSTRAINT inventory_consumptions_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: inventory_consumptions inventory_consumptions_purchase_id_stock_purchases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_consumptions
    ADD CONSTRAINT inventory_consumptions_purchase_id_stock_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES public.stock_purchases(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: pdf_test_fixtures pdf_test_fixtures_run_id_pdf_test_runs_run_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_fixtures
    ADD CONSTRAINT pdf_test_fixtures_run_id_pdf_test_runs_run_id_fk FOREIGN KEY (run_id) REFERENCES public.pdf_test_runs(run_id) ON DELETE CASCADE;


--
-- Name: pdf_test_runs pdf_test_runs_owner_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_test_runs
    ADD CONSTRAINT pdf_test_runs_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: purchase_bill_items purchase_bill_items_bill_id_purchase_bills_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_bill_items
    ADD CONSTRAINT purchase_bill_items_bill_id_purchase_bills_id_fk FOREIGN KEY (bill_id) REFERENCES public.purchase_bills(id) ON DELETE CASCADE;


--
-- Name: purchase_bill_items purchase_bill_items_stock_purchase_id_stock_purchases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_bill_items
    ADD CONSTRAINT purchase_bill_items_stock_purchase_id_stock_purchases_id_fk FOREIGN KEY (stock_purchase_id) REFERENCES public.stock_purchases(id) ON DELETE SET NULL;


--
-- Name: trader_ledger_entries trader_ledger_entries_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: trader_ledger_entries trader_ledger_entries_trader_id_wholesale_traders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_trader_id_wholesale_traders_id_fk FOREIGN KEY (trader_id) REFERENCES public.wholesale_traders(id) ON DELETE CASCADE;


--
-- Name: trader_ledger_entries trader_ledger_entries_wholesale_invoice_id_wholesale_invoices_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_wholesale_invoice_id_wholesale_invoices_i FOREIGN KEY (wholesale_invoice_id) REFERENCES public.wholesale_invoices(id) ON DELETE SET NULL;


--
-- Name: trader_ledger_entries trader_ledger_entries_wholesale_item_id_wholesale_invoice_items; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_wholesale_item_id_wholesale_invoice_items FOREIGN KEY (wholesale_item_id) REFERENCES public.wholesale_invoice_items(id) ON DELETE SET NULL;


--
-- Name: trader_ledger_entries trader_ledger_entries_wholesale_return_id_wholesale_returns_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_wholesale_return_id_wholesale_returns_id_ FOREIGN KEY (wholesale_return_id) REFERENCES public.wholesale_returns(id) ON DELETE SET NULL;


--
-- Name: trader_ledger_entries trader_ledger_entries_wholesale_settlement_id_wholesale_settlem; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trader_ledger_entries
    ADD CONSTRAINT trader_ledger_entries_wholesale_settlement_id_wholesale_settlem FOREIGN KEY (wholesale_settlement_id) REFERENCES public.wholesale_settlements(id) ON DELETE SET NULL;


--
-- Name: wholesale_inventory_consumptions wholesale_inventory_consumptions_purchase_id_stock_purchases_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_inventory_consumptions
    ADD CONSTRAINT wholesale_inventory_consumptions_purchase_id_stock_purchases_id FOREIGN KEY (purchase_id) REFERENCES public.stock_purchases(id) ON DELETE SET NULL;


--
-- Name: wholesale_inventory_consumptions wholesale_inventory_consumptions_wholesale_invoice_id_wholesale; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_inventory_consumptions
    ADD CONSTRAINT wholesale_inventory_consumptions_wholesale_invoice_id_wholesale FOREIGN KEY (wholesale_invoice_id) REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE;


--
-- Name: wholesale_inventory_consumptions wholesale_inventory_consumptions_wholesale_item_id_wholesale_in; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_inventory_consumptions
    ADD CONSTRAINT wholesale_inventory_consumptions_wholesale_item_id_wholesale_in FOREIGN KEY (wholesale_item_id) REFERENCES public.wholesale_invoice_items(id) ON DELETE CASCADE;


--
-- Name: wholesale_invoice_items wholesale_invoice_items_invoice_id_wholesale_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoice_items
    ADD CONSTRAINT wholesale_invoice_items_invoice_id_wholesale_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE;


--
-- Name: wholesale_invoices wholesale_invoices_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoices
    ADD CONSTRAINT wholesale_invoices_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wholesale_invoices wholesale_invoices_trader_id_wholesale_traders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_invoices
    ADD CONSTRAINT wholesale_invoices_trader_id_wholesale_traders_id_fk FOREIGN KEY (trader_id) REFERENCES public.wholesale_traders(id) ON DELETE SET NULL;


--
-- Name: wholesale_return_lines wholesale_return_lines_invoice_item_id_wholesale_invoice_items_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_return_lines
    ADD CONSTRAINT wholesale_return_lines_invoice_item_id_wholesale_invoice_items_ FOREIGN KEY (invoice_item_id) REFERENCES public.wholesale_invoice_items(id) ON DELETE CASCADE;


--
-- Name: wholesale_return_lines wholesale_return_lines_return_id_wholesale_returns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_return_lines
    ADD CONSTRAINT wholesale_return_lines_return_id_wholesale_returns_id_fk FOREIGN KEY (return_id) REFERENCES public.wholesale_returns(id) ON DELETE CASCADE;


--
-- Name: wholesale_returns wholesale_returns_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_returns
    ADD CONSTRAINT wholesale_returns_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wholesale_returns wholesale_returns_invoice_id_wholesale_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_returns
    ADD CONSTRAINT wholesale_returns_invoice_id_wholesale_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE;


--
-- Name: wholesale_settlement_allocations wholesale_settlement_allocations_invoice_item_id_wholesale_invo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlement_allocations
    ADD CONSTRAINT wholesale_settlement_allocations_invoice_item_id_wholesale_invo FOREIGN KEY (invoice_item_id) REFERENCES public.wholesale_invoice_items(id) ON DELETE CASCADE;


--
-- Name: wholesale_settlement_allocations wholesale_settlement_allocations_settlement_id_wholesale_settle; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlement_allocations
    ADD CONSTRAINT wholesale_settlement_allocations_settlement_id_wholesale_settle FOREIGN KEY (settlement_id) REFERENCES public.wholesale_settlements(id) ON DELETE CASCADE;


--
-- Name: wholesale_settlements wholesale_settlements_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlements
    ADD CONSTRAINT wholesale_settlements_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wholesale_settlements wholesale_settlements_invoice_id_wholesale_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_settlements
    ADD CONSTRAINT wholesale_settlements_invoice_id_wholesale_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.wholesale_invoices(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dHNFcNstMpbmdngfo8iKpTS5pAgRzDbthe9es5iZU7I8jy5XiMn1pbmaDPI8h3a

