/**
 * UserNamespace tests
 *
 * Tests for user balance, payment, preferences, and saved releases operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  UserNamespace,
  BalanceNamespace,
  PaymentNamespace,
  PreferencesNamespace,
  AudioPreferencesNamespace,
  SavedReleasesNamespace,
  type UserBalanceResponse,
  type PaymentMethod,
  type DepositResponse,
  type Transaction,
  type AudioToolPreferences,
  type SavedReleasesDoc,
} from "../../src/namespaces/user/index.js";
import type { HttpClient } from "../../src/http-client.js";

// Mock HttpClient
function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    postFormData: vi.fn(),
    getToken: vi.fn(),
    setToken: vi.fn(),
    setRefreshToken: vi.fn(),
    clearTokens: vi.fn(),
  } as unknown as HttpClient;
}

// Sample data
const sampleBalance: UserBalanceResponse = {
  balance: "10000000",
  formattedBalance: "$100.00",
  currency: "USD",
};

const samplePaymentMethod: PaymentMethod = {
  id: "pm_123",
  type: "card",
  card: {
    brand: "visa",
    last4: "4242",
    expMonth: 12,
    expYear: 2025,
  },
  isDefault: true,
};

const sampleDepositResponse: DepositResponse = {
  status: "succeeded",
  amount: 1000,
  transactionId: "tx_123",
};

const sampleTransaction: Transaction = {
  id: "tx_123",
  type: "deposit",
  amount: "1000",
  description: "Deposit via card",
  createdAt: "2024-01-01T00:00:00Z",
};

const samplePreferences: AudioToolPreferences = {
  defaultTranscriberTool: "whisper",
  defaultDiarizerTool: "pyannote",
  defaultChunkingTool: "semantic",
};

const sampleSavedReleases: SavedReleasesDoc = {
  _id: "sr_123",
  userId: "user_456",
  savedReleases: ["rel_1", "rel_2"],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("BalanceNamespace", () => {
  let mockHttpClient: HttpClient;
  let balanceNamespace: BalanceNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    balanceNamespace = new BalanceNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("should GET /user/money/balance", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleBalance);

      await balanceNamespace.get();

      expect(mockHttpClient.get).toHaveBeenCalledWith("/user/money/balance");
    });

    it("should return UserBalanceResponse", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleBalance);

      const result = await balanceNamespace.get();

      expect(result).toEqual(sampleBalance);
    });
  });
});

describe("PaymentNamespace", () => {
  let mockHttpClient: HttpClient;
  let paymentNamespace: PaymentNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    paymentNamespace = new PaymentNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listMethods", () => {
    it("should GET payment methods", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([samplePaymentMethod]);

      await paymentNamespace.listMethods();

      expect(mockHttpClient.get).toHaveBeenCalledWith("/user/money/payment-method/list");
    });

    it("should return array of PaymentMethod", async () => {
      const methods = [samplePaymentMethod];
      vi.mocked(mockHttpClient.get).mockResolvedValue(methods);

      const result = await paymentNamespace.listMethods();

      expect(result).toEqual(methods);
    });
  });

  describe("deposit", () => {
    it("should POST deposit with amount and paymentMethodId", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleDepositResponse);

      await paymentNamespace.deposit({ amount: 1000, paymentMethodId: "pm_123" });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/user/money/deposit",
        { amount: 1000, paymentMethodId: "pm_123" }
      );
    });

    it("should return DepositResponse", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleDepositResponse);

      const result = await paymentNamespace.deposit({
        amount: 1000,
        paymentMethodId: "pm_123",
      });

      expect(result).toEqual(sampleDepositResponse);
    });
  });

  describe("getTransactions", () => {
    it("should GET transactions with date range", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleTransaction]);

      await paymentNamespace.getTransactions({
        start: "2024-01-01",
        end: "2024-12-31",
      });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/user/money/transactions",
        { start: "2024-01-01", end: "2024-12-31" }
      );
    });

    it("should work without date range", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue([sampleTransaction]);

      await paymentNamespace.getTransactions();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/user/money/transactions",
        undefined
      );
    });
  });
});

describe("AudioPreferencesNamespace", () => {
  let mockHttpClient: HttpClient;
  let audioPreferencesNamespace: AudioPreferencesNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    audioPreferencesNamespace = new AudioPreferencesNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("should GET audio preferences", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(samplePreferences);

      await audioPreferencesNamespace.get();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/user/preferences/audio-tools"
      );
    });
  });

  describe("update", () => {
    it("should PUT preferences (full replacement)", async () => {
      vi.mocked(mockHttpClient.put).mockResolvedValue(samplePreferences);

      await audioPreferencesNamespace.update({
        defaultTranscriberTool: "deepgram",
      });

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "/user/preferences/audio-tools",
        { defaultTranscriberTool: "deepgram" }
      );
    });
  });
});

describe("PreferencesNamespace", () => {
  let mockHttpClient: HttpClient;
  let preferencesNamespace: PreferencesNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    preferencesNamespace = new PreferencesNamespace(mockHttpClient);
  });

  describe("audio", () => {
    it("should lazily initialize AudioPreferencesNamespace", () => {
      const audio = preferencesNamespace.audio;
      expect(audio).toBeInstanceOf(AudioPreferencesNamespace);
    });

    it("should reuse same instance", () => {
      const audio1 = preferencesNamespace.audio;
      const audio2 = preferencesNamespace.audio;
      expect(audio1).toBe(audio2);
    });
  });
});

describe("SavedReleasesNamespace", () => {
  let mockHttpClient: HttpClient;
  let savedReleasesNamespace: SavedReleasesNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    savedReleasesNamespace = new SavedReleasesNamespace(mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should GET saved releases", async () => {
      vi.mocked(mockHttpClient.get).mockResolvedValue(sampleSavedReleases);

      await savedReleasesNamespace.list();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/user/saved-releases"
      );
    });
  });

  describe("add", () => {
    it("should POST releaseId", async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue(sampleSavedReleases);

      await savedReleasesNamespace.add("rel_123");

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/user/saved-releases",
        { releaseId: "rel_123" }
      );
    });
  });

  describe("remove", () => {
    it("should DELETE releaseId", async () => {
      vi.mocked(mockHttpClient.delete).mockResolvedValue(sampleSavedReleases);

      await savedReleasesNamespace.remove("rel_123");

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "/user/saved-releases/rel_123"
      );
    });
  });
});

describe("UserNamespace", () => {
  let mockHttpClient: HttpClient;
  let userNamespace: UserNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    userNamespace = new UserNamespace(mockHttpClient);
  });

  describe("sub-namespaces", () => {
    describe("balance", () => {
      it("should lazily initialize BalanceNamespace", () => {
        const balance = userNamespace.balance;
        expect(balance).toBeInstanceOf(BalanceNamespace);
      });

      it("should reuse same instance", () => {
        const b1 = userNamespace.balance;
        const b2 = userNamespace.balance;
        expect(b1).toBe(b2);
      });
    });

    describe("payment", () => {
      it("should lazily initialize PaymentNamespace", () => {
        const payment = userNamespace.payment;
        expect(payment).toBeInstanceOf(PaymentNamespace);
      });

      it("should reuse same instance", () => {
        const p1 = userNamespace.payment;
        const p2 = userNamespace.payment;
        expect(p1).toBe(p2);
      });
    });

    describe("preferences", () => {
      it("should lazily initialize PreferencesNamespace", () => {
        const preferences = userNamespace.preferences;
        expect(preferences).toBeInstanceOf(PreferencesNamespace);
      });

      it("should reuse same instance", () => {
        const pref1 = userNamespace.preferences;
        const pref2 = userNamespace.preferences;
        expect(pref1).toBe(pref2);
      });
    });

    describe("releases", () => {
      it("should lazily initialize SavedReleasesNamespace", () => {
        const releases = userNamespace.releases;
        expect(releases).toBeInstanceOf(SavedReleasesNamespace);
      });

      it("should reuse same instance", () => {
        const r1 = userNamespace.releases;
        const r2 = userNamespace.releases;
        expect(r1).toBe(r2);
      });
    });
  });
});
