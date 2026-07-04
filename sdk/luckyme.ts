/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/luckyme.json`.
 */
export type Luckyme = {
  "address": "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3",
  "metadata": {
    "name": "luckyme",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "LuckyMe fixed-entry Solana luck pools"
  },
  "instructions": [
    {
      "name": "buyTickets",
      "discriminator": [
        48,
        16,
        122,
        137,
        24,
        214,
        198,
        58
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "entry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "round"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ticketCount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeEmptyRoundAfterTimeout",
      "discriminator": [
        234,
        155,
        116,
        12,
        103,
        105,
        47,
        99
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "houseFeeBps",
          "type": "u16"
        },
        {
          "name": "jackpotBps",
          "type": "u16"
        },
        {
          "name": "jackpotOddsDenominator",
          "type": "u32"
        },
        {
          "name": "roundDurationSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializePool",
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "jackpotVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "poolId",
          "type": "u8"
        },
        {
          "name": "ticketPriceLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openRound",
      "discriminator": [
        66,
        235,
        123,
        240,
        8,
        35,
        185,
        159
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "randomnessCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refundEntryAfterTimeout",
      "discriminator": [
        172,
        253,
        138,
        92,
        31,
        211,
        240,
        150
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleRound",
      "discriminator": [
        40,
        101,
        18,
        1,
        31,
        129,
        52,
        77
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "jackpotVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "winner",
          "writable": true
        },
        {
          "name": "winnerEntry"
        },
        {
          "name": "jackpotWinner",
          "writable": true
        },
        {
          "name": "jackpotEntry"
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "randomnessReveal",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "entry",
      "discriminator": [
        63,
        18,
        152,
        113,
        215,
        246,
        221,
        250
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "round",
      "discriminator": [
        87,
        127,
        165,
        51,
        73,
        78,
        116,
        174
      ]
    }
  ],
  "events": [
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "emptyRoundClosed",
      "discriminator": [
        152,
        13,
        45,
        105,
        245,
        8,
        151,
        214
      ]
    },
    {
      "name": "entryRefunded",
      "discriminator": [
        34,
        82,
        130,
        116,
        93,
        139,
        188,
        234
      ]
    },
    {
      "name": "pausedSet",
      "discriminator": [
        171,
        125,
        127,
        156,
        233,
        81,
        68,
        66
      ]
    },
    {
      "name": "poolInitialized",
      "discriminator": [
        100,
        118,
        173,
        87,
        12,
        198,
        254,
        229
      ]
    },
    {
      "name": "roundOpened",
      "discriminator": [
        99,
        173,
        228,
        72,
        142,
        57,
        109,
        178
      ]
    },
    {
      "name": "roundSettled",
      "discriminator": [
        249,
        225,
        66,
        54,
        157,
        200,
        234,
        222
      ]
    },
    {
      "name": "ticketsBought",
      "discriminator": [
        204,
        103,
        221,
        60,
        70,
        142,
        88,
        233
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "feeTooHigh",
      "msg": "Fee is too high"
    },
    {
      "code": 6001,
      "name": "jackpotFeeTooHigh",
      "msg": "Jackpot fee is too high"
    },
    {
      "code": 6002,
      "name": "invalidFeeConfig",
      "msg": "Invalid fee configuration"
    },
    {
      "code": 6003,
      "name": "invalidOdds",
      "msg": "Invalid jackpot odds"
    },
    {
      "code": 6004,
      "name": "invalidRoundDuration",
      "msg": "Invalid round duration"
    },
    {
      "code": 6005,
      "name": "invalidTicketPrice",
      "msg": "Invalid ticket price"
    },
    {
      "code": 6006,
      "name": "invalidTicketCount",
      "msg": "Invalid ticket count"
    },
    {
      "code": 6007,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6008,
      "name": "roundClosed",
      "msg": "Round is closed"
    },
    {
      "code": 6009,
      "name": "roundStillOpen",
      "msg": "Round is still open"
    },
    {
      "code": 6010,
      "name": "roundSettled",
      "msg": "Round is already settled"
    },
    {
      "code": 6011,
      "name": "emptyRound",
      "msg": "Round has no tickets"
    },
    {
      "code": 6012,
      "name": "invalidRandomnessCommitment",
      "msg": "Invalid randomness commitment"
    },
    {
      "code": 6013,
      "name": "invalidRandomnessReveal",
      "msg": "Invalid randomness reveal"
    },
    {
      "code": 6014,
      "name": "wrongWinnerEntry",
      "msg": "Wrong winner entry was provided"
    },
    {
      "code": 6015,
      "name": "wrongJackpotEntry",
      "msg": "Wrong jackpot entry was provided"
    },
    {
      "code": 6016,
      "name": "winnerMismatch",
      "msg": "Winner account does not match entry"
    },
    {
      "code": 6017,
      "name": "insufficientVaultFunds",
      "msg": "Vault does not have enough lamports"
    },
    {
      "code": 6018,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6019,
      "name": "alreadyEnteredRound",
      "msg": "Wallet already entered this round"
    },
    {
      "code": 6020,
      "name": "refundNotAvailable",
      "msg": "Refund is not available yet"
    },
    {
      "code": 6021,
      "name": "nothingToRefund",
      "msg": "Entry has nothing to refund"
    },
    {
      "code": 6022,
      "name": "roundHasEntries",
      "msg": "Round already has entries"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "houseFeeBps",
            "type": "u16"
          },
          {
            "name": "jackpotBps",
            "type": "u16"
          },
          {
            "name": "jackpotOddsDenominator",
            "type": "u32"
          },
          {
            "name": "roundDurationSecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "houseFeeBps",
            "type": "u16"
          },
          {
            "name": "jackpotBps",
            "type": "u16"
          },
          {
            "name": "jackpotOddsDenominator",
            "type": "u32"
          },
          {
            "name": "roundDurationSecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "emptyRoundClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "entry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "ticketStart",
            "type": "u64"
          },
          {
            "name": "ticketCount",
            "type": "u64"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "entryRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "entry",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "refundLamports",
            "type": "u64"
          },
          {
            "name": "refundTickets",
            "type": "u64"
          },
          {
            "name": "roundTotalTickets",
            "type": "u64"
          },
          {
            "name": "roundTotalLamports",
            "type": "u64"
          },
          {
            "name": "remainingEntrantCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "pausedSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u8"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "currentRound",
            "type": "u64"
          },
          {
            "name": "jackpotLamports",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "jackpotBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u8"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "poolVault",
            "type": "pubkey"
          },
          {
            "name": "jackpotVault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "round",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u64"
          },
          {
            "name": "totalLamports",
            "type": "u64"
          },
          {
            "name": "entrantCount",
            "type": "u32"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "jackpotTriggered",
            "type": "bool"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "jackpotWinner",
            "type": "pubkey"
          },
          {
            "name": "randomnessCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "randomnessCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "roundSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "winnerEntry",
            "type": "pubkey"
          },
          {
            "name": "winningTicket",
            "type": "u64"
          },
          {
            "name": "mainPrizeLamports",
            "type": "u64"
          },
          {
            "name": "houseFeeLamports",
            "type": "u64"
          },
          {
            "name": "jackpotAddLamports",
            "type": "u64"
          },
          {
            "name": "jackpotTriggered",
            "type": "bool"
          },
          {
            "name": "jackpotWinner",
            "type": "pubkey"
          },
          {
            "name": "jackpotEntry",
            "type": "pubkey"
          },
          {
            "name": "jackpotTicket",
            "type": "u64"
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ticketsBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "entry",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "ticketStart",
            "type": "u64"
          },
          {
            "name": "ticketCount",
            "type": "u64"
          },
          {
            "name": "entryTicketCount",
            "type": "u64"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          },
          {
            "name": "roundTotalTickets",
            "type": "u64"
          },
          {
            "name": "roundTotalLamports",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
