package dev.agentscanner.config;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SpaRoutingControllerTest {

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new SpaRoutingController()).build();

    @Test
    void forwardsSessionRoutesToTheAngularApplication() throws Exception {
        mvc.perform(get("/sessions/42"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/sessions/42/cost")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/standardization")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/sessions/42/standardization")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/repositories/new")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/repositories/123/analyses/456")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
    }
}
